defmodule Nexus.AntiSpam.CompositionAnalyser do
  @moduledoc """
  Analyses composition metadata submitted alongside new posts and replies
  to detect automated or pasted spam content.

  Operates in three phases:
    1. Graduation check  — established users bypass analysis entirely.
    2. Scoring           — five signal-based rules produce a verdict.
    3. Action            — hold the content (pending_approval) or log only.

  All thresholds are read from the `anti_spam` site setting key at
  call time so changes take effect without a restart.

  Verdicts
    metadata_missing     — no compositionSignals submitted (API/bot)
    implausibly_fast     — typed faster than velocity_chars_per_second
    no_keystrokes        — non-trivial content with zero keystrokes (paste/inject)
    dominated_by_paste   — paste events account for > paste_ratio_threshold of chars
    short_post_skipped   — post too short to evaluate reliably
    plausible            — all checks passed; no hold

  Only metadata_missing, implausibly_fast, no_keystrokes, and
  dominated_by_paste set should_hold: true.
  """

  import Ecto.Query
  alias Nexus.Repo
  alias Nexus.AntiSpam.CompositionVerdict

  @schema_version 1

  # Verdict constants
  @verdict_missing    "metadata_missing"
  @verdict_fast       "implausibly_fast"
  @verdict_no_keys    "no_keystrokes"
  @verdict_paste      "dominated_by_paste"
  @verdict_short      "short_post_skipped"
  @verdict_plausible  "plausible"

  # ---------------------------------------------------------------------------
  # Public API — called from post_controller and reply_controller
  # ---------------------------------------------------------------------------

  @doc """
  Check whether a new post or reply should be held based on composition signals.

  Returns:
    :pass                    — user graduated or feature disabled
    {:hold, verdict, details} — content should be set pending_approval
    {:log, verdict, details}  — report-only mode; log but do not hold
  """
  def check(user, content, composition_signals) do
    cfg = Nexus.Admin.get_setting("anti_spam") || %{}

    unless cfg["composition_enabled"] do
      :pass
    else
      if graduated?(user, cfg) do
        :pass
      else
        char_count = String.length(content || "")
        result     = evaluate(composition_signals, char_count, cfg)

        if result.should_hold do
          if cfg["composition_report_only"] do
            {:log, result.verdict, result.details}
          else
            {:hold, result.verdict, result.details}
          end
        else
          :pass
        end
      end
    end
  end

  @doc """
  Record a verdict to the composition_verdicts table.
  Called after the post/reply has been saved so we have its id.
  """
  def record_verdict(attrs) do
    %CompositionVerdict{}
    |> CompositionVerdict.changeset(attrs)
    |> Repo.insert()
  end

  @doc """
  Count pending composition verdicts (held, not yet approved/rejected).
  Used in the admin stats block.
  """
  def pending_count do
    from(v in CompositionVerdict,
      join: p in Nexus.Forum.Post, on: p.id == v.post_id,
      where: p.pending_approval == true and p.hidden == false,
      select: count(v.id)
    )
    |> Repo.one() || 0
  end

  @doc """
  Summary stats for the admin panel.
  """
  def stats do
    total = Repo.aggregate(CompositionVerdict, :count)

    by_verdict =
      from(v in CompositionVerdict,
        group_by: v.verdict,
        select: {v.verdict, count(v.id)}
      )
      |> Repo.all()
      |> Map.new()

    %{total: total, by_verdict: by_verdict, pending: pending_count()}
  end

  # ---------------------------------------------------------------------------
  # Graduation check
  # ---------------------------------------------------------------------------

  defp graduated?(user, cfg) do
    # Admins and moderators are never screened
    if user.role in ["admin", "moderator"] do
      true
    else
      post_threshold = parse_int(cfg["composition_approved_threshold"], 5)
      age_threshold  = parse_int(cfg["composition_min_account_age_days"], 3)

      account_age_days =
        DateTime.diff(DateTime.utc_now(), user.inserted_at, :second)
        |> div(86_400)

      if account_age_days < age_threshold do
        false
      else
        approved_count =
          from(p in Nexus.Forum.Post,
            where: p.user_id == ^user.id
              and p.hidden == false
              and p.pending_approval == false,
            select: count(p.id)
          )
          |> Repo.one() || 0

        approved_count >= post_threshold
      end
    end
  end

  # ---------------------------------------------------------------------------
  # Scoring
  # ---------------------------------------------------------------------------

  defp evaluate(signals, char_count, cfg) do
    velocity_threshold   = parse_float(cfg["composition_velocity_cps"],      10.0)
    min_len_velocity     = parse_int(cfg["composition_min_len_velocity"],     100)
    paste_ratio          = parse_float(cfg["composition_paste_ratio"],        0.8)
    min_len_paste        = parse_int(cfg["composition_min_len_paste"],        150)
    hold_missing         = cfg["composition_hold_missing"] == true

    # Rule 1: missing or invalid metadata
    unless valid_signals?(signals) do
      return_result(@verdict_missing, hold_missing, %{char_count: char_count})
    else
      active_ms       = signals["activeMs"]       || 0
      keystroke_count = signals["keystrokeCount"] || 0
      paste_events    = signals["pasteEvents"]    || []
      final_chars     = signals["finalCharCount"] || char_count

      # Rule 2: short post — skip
      if final_chars < min_len_velocity and final_chars < min_len_paste do
        return_result(@verdict_short, false, %{char_count: final_chars})

      # Rule 3: implausibly fast
      elsif final_chars >= min_len_velocity do
        active_sec = active_ms / 1000.0
        rate       = if active_sec > 0, do: final_chars / active_sec, else: :infinity

        if rate == :infinity or rate > velocity_threshold do
          return_result(@verdict_fast, true, %{
            char_count:       final_chars,
            active_ms:        active_ms,
            chars_per_second: if(rate == :infinity, do: nil, else: Float.round(rate, 2)),
            threshold:        velocity_threshold
          })

        # Rule 4: no keystrokes
        elsif keystroke_count == 0 do
          return_result(@verdict_no_keys, true, %{
            char_count:      final_chars,
            keystroke_count: keystroke_count
          })

        # Rule 5: dominated by paste
        else
          check_paste(final_chars, paste_events, paste_ratio, min_len_paste)
        end

      # Only paste check applies at this char count
      else
        check_paste(final_chars, paste_events, paste_ratio, min_len_paste)
      end
    end
  end

  defp check_paste(final_chars, paste_events, paste_ratio, min_len_paste) do
    if final_chars >= min_len_paste do
      pasted_chars = paste_events |> Enum.map(&(&1["chars"] || 0)) |> Enum.sum()
      ratio        = if final_chars > 0, do: pasted_chars / final_chars, else: 0.0

      if ratio > paste_ratio do
        return_result(@verdict_paste, true, %{
          char_count:   final_chars,
          pasted_chars: pasted_chars,
          paste_ratio:  Float.round(ratio, 4),
          threshold:    paste_ratio
        })
      else
        return_result(@verdict_plausible, false, %{char_count: final_chars})
      end
    else
      return_result(@verdict_plausible, false, %{char_count: final_chars})
    end
  end

  defp valid_signals?(nil), do: false
  defp valid_signals?(signals) when is_map(signals) do
    signals["schemaVersion"] == @schema_version and
      Map.has_key?(signals, "activeMs") and
      Map.has_key?(signals, "keystrokeCount") and
      Map.has_key?(signals, "pasteEvents") and
      Map.has_key?(signals, "finalCharCount")
  end
  defp valid_signals?(_), do: false

  defp return_result(verdict, should_hold, details) do
    %{verdict: verdict, should_hold: should_hold, details: details}
  end

  defp parse_int(nil, default), do: default
  defp parse_int(v, _default) when is_integer(v), do: v
  defp parse_int(v, default) do
    case Integer.parse(to_string(v)) do
      {n, _} -> n
      :error  -> default
    end
  end

  defp parse_float(nil, default), do: default
  defp parse_float(v, _default) when is_float(v), do: v
  defp parse_float(v, _default) when is_integer(v), do: v / 1.0
  defp parse_float(v, default) do
    case Float.parse(to_string(v)) do
      {f, _} -> f
      :error  -> default
    end
  end
end
