defmodule Nexus.AntiSpam do
  @moduledoc """
  Anti-spam context.

  Provides:
  - StopForumSpam (SFS) check at registration time
  - Honeypot field validation at registration time
  - Blocked registration logging
  - mark_as_spammer/2 — bulk-bans a user and deletes all their content
  """

  import Ecto.Query
  require Logger

  alias Nexus.Repo
  alias Nexus.AntiSpam.BlockedRegistration
  alias Nexus.Accounts
  alias Nexus.Moderation

  # ---------------------------------------------------------------------------
  # Registration checks
  # ---------------------------------------------------------------------------

  @doc """
  Returns {:block, reason_string} if the registration should be rejected,
  or :allow otherwise.

  Checks (in order):
  1. Honeypot — if the hidden `_email_confirm` field is non-empty, it's a bot.
  2. StopForumSpam — if SFS returns a positive match for IP, email or username.
  """
  def check_registration(ip, email, username, params) do
    cond do
      honeypot_triggered?(params) ->
        log_blocked(ip, email, username, "honeypot", nil)
        {:block, "Registration failed validation"}

      sfs_enabled?() ->
        case sfs_check(ip, email, username) do
          {:spam, sfs_data} ->
            log_blocked(ip, email, username, "sfs", sfs_data)
            {:block, "Registration blocked by spam filter"}

          :ok ->
            :allow
        end

      true ->
        :allow
    end
  end

  # ---------------------------------------------------------------------------
  # Mark as spammer
  # ---------------------------------------------------------------------------

  @doc """
  Marks a user as a spammer: bans them, deletes all their posts, replies,
  and DM threads, then revokes all tokens.

  Returns {:ok, :done} or {:error, reason}.
  """
  def mark_as_spammer(admin, target_user) do
    Repo.transaction(fn ->
      # Delete all posts (replies cascade via FK)
      Repo.delete_all(from p in Nexus.Forum.Post, where: p.user_id == ^target_user.id)

      # Delete any orphaned replies not covered by cascade
      Repo.delete_all(from r in Nexus.Forum.Reply, where: r.user_id == ^target_user.id)

      # Delete all DM threads the user created (members cascade via FK)
      Repo.delete_all(
        from t in Nexus.Messaging.Thread,
          where: t.creator_id == ^target_user.id
      )

      # Remove user from any threads they're a member of
      Repo.delete_all(
        from m in Nexus.Messaging.ThreadMember,
          where: m.user_id == ^target_user.id
      )

      # Ban the user
      {:ok, _} = Moderation.ban_user(admin, target_user, "Marked as spammer")
    end)
    |> case do
      {:ok, _} ->
        # Revoke tokens outside transaction (non-critical)
        Accounts.revoke_all_user_tokens(target_user.id)

        Logger.info("AntiSpam: #{admin.username} marked #{target_user.username} (id=#{target_user.id}) as spammer")
        {:ok, :done}

      {:error, reason} ->
        Logger.error("AntiSpam: mark_as_spammer failed for user #{target_user.id}: #{inspect(reason)}")
        {:error, reason}
    end
  end

  # ---------------------------------------------------------------------------
  # Blocked registrations log
  # ---------------------------------------------------------------------------

  @doc "List the most recent blocked registration attempts."
  def list_blocked_registrations(limit \\ 100) do
    BlockedRegistration
    |> order_by([b], desc: b.inserted_at)
    |> limit(^limit)
    |> Repo.all()
  end

  # ---------------------------------------------------------------------------
  # New-account DM restriction
  # ---------------------------------------------------------------------------

  @minimum_account_age_hours 24

  @doc """
  Returns true if the user's account is old enough to send DMs.
  Admins and moderators are always allowed.
  """
  def can_send_dm?(%Nexus.Accounts.User{role: role}) when role in ["admin", "moderator"], do: true
  def can_send_dm?(%Nexus.Accounts.User{inserted_at: inserted_at}) do
    age_hours = DateTime.diff(DateTime.utc_now(), inserted_at, :hour)
    age_hours >= @minimum_account_age_hours
  end

  # ---------------------------------------------------------------------------
  # Private helpers
  # ---------------------------------------------------------------------------

  defp honeypot_triggered?(params) do
    # The `_hp` field is hidden via CSS in the frontend.
    # Bots that fill all fields will populate it; real users never see it.
    val = Map.get(params, "_hp", "")
    is_binary(val) and String.trim(val) != ""
  end

  defp sfs_enabled? do
    cfg = Nexus.Admin.get_setting("anti_spam") || %{}
    cfg["sfs_enabled"] == true
  end

  defp sfs_check(ip, email, username) do
    # Build query params — email is sent as md5 hash to reduce PII exposure
    params = %{
      "json"       => "1",
      "confidence" => "1"
    }
    |> maybe_add("ip",         ip)
    |> maybe_add("emailhash",  email && :crypto.hash(:md5, String.downcase(email)) |> Base.encode16(case: :lower))
    |> maybe_add("username",   username)

    url = "https://api.stopforumspam.org/api?" <> URI.encode_query(params)

    case Req.get(url, receive_timeout: 5_000) do
      {:ok, %{status: 200, body: body}} ->
        evaluate_sfs_response(body)

      other ->
        Logger.warning("AntiSpam: SFS request failed: #{inspect(other)}")
        # Fail open — don't block registrations if SFS is unreachable
        :ok
    end
  end

  defp maybe_add(params, _key, nil),   do: params
  defp maybe_add(params, _key, ""),    do: params
  defp maybe_add(params, key, value),  do: Map.put(params, key, value)

  defp evaluate_sfs_response(body) when is_map(body) do
    cfg = Nexus.Admin.get_setting("anti_spam") || %{}
    frequency_threshold = (cfg["sfs_frequency"] || 5) |> to_int()
    confidence_threshold = (cfg["sfs_confidence"] || 50.0) |> to_float()

    fields = ["ip", "email", "username"]

    result = Enum.reduce(fields, %{frequency: 0, confidence: 0.0, blacklisted: false}, fn field, acc ->
      case get_in(body, [field]) do
        %{"appears" => 1} = data ->
          freq       = to_int(data["frequency"] || 0)
          conf       = to_float(data["confidence"] || 0.0)
          blacklist  = data["blacklisted"] == 1 || data["blacklisted"] == true
          %{acc |
            frequency:   acc.frequency + freq,
            confidence:  max(acc.confidence, conf),
            blacklisted: acc.blacklisted || blacklist
          }
        _ ->
          acc
      end
    end)

    if result.blacklisted ||
       result.frequency >= frequency_threshold ||
       result.confidence >= confidence_threshold do
      {:spam, body}
    else
      :ok
    end
  end

  defp evaluate_sfs_response(_), do: :ok

  defp log_blocked(ip, email, username, reason, sfs_data) do
    %BlockedRegistration{}
    |> BlockedRegistration.changeset(%{
      ip:       ip,
      email:    email,
      username: username,
      reason:   reason,
      sfs_data: sfs_data
    })
    |> Repo.insert()
  end

  defp to_int(v) when is_integer(v), do: v
  defp to_int(v) when is_float(v),   do: round(v)
  defp to_int(v) when is_binary(v) do
    case Integer.parse(v) do
      {i, _} -> i
      :error  -> 0
    end
  end
  defp to_int(_), do: 0

  defp to_float(v) when is_float(v),   do: v
  defp to_float(v) when is_integer(v), do: v / 1.0
  defp to_float(v) when is_binary(v) do
    case Float.parse(v) do
      {f, _} -> f
      :error  -> 0.0
    end
  end
  defp to_float(_), do: 0.0
end
