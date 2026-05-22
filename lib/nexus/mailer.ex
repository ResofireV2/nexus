defmodule Nexus.Mailer do
  @moduledoc """
  Email delivery. Reads configuration from admin panel settings at send time,
  so changes take effect immediately without a restart.
  Falls back to the local Swoosh adapter in dev if no SMTP is configured.
  """

  use Swoosh.Mailer, otp_app: :nexus
  import Swoosh.Email

  defp email_settings do
    case Nexus.Admin.get_setting("email") do
      s when is_map(s) -> s
      _ -> %{}
    end
  end

  defp general_settings do
    case Nexus.Admin.get_setting("general") do
      s when is_map(s) -> s
      _ -> %{}
    end
  end

  defp build_config(settings) do
    case Map.get(settings, "provider", "smtp") do
      "postmark" ->
        key = Map.get(settings, "api_key", "")
        if key != "", do: {:ok, adapter: Swoosh.Adapters.Postmark, api_key: key},
          else: {:error, "Postmark API key not configured"}

      "resend" ->
        key = Map.get(settings, "api_key", "")
        if key != "", do: {:ok, adapter: Swoosh.Adapters.Resend, api_key: key},
          else: {:error, "Resend API key not configured"}

      "mailgun" ->
        key    = Map.get(settings, "api_key", "")
        domain = Map.get(settings, "mailgun_domain", "")
        if key != "" and domain != "",
          do: {:ok, adapter: Swoosh.Adapters.Mailgun, api_key: key, domain: domain},
          else: {:error, "Mailgun API key and domain required"}

      _ ->
        host     = Map.get(settings, "smtp_host", "")
        port     = (Map.get(settings, "smtp_port", "587") |> to_string() |> Integer.parse() |> elem(0))
        username = Map.get(settings, "smtp_username", "")
        password = Map.get(settings, "smtp_password", "")
        tls      = case Map.get(settings, "smtp_encryption", "tls") do
          "ssl"  -> :always
          "none" -> :never
          _      -> :if_available
        end

        if host != "" do
          {:ok, adapter: Swoosh.Adapters.SMTP,
            relay: host, port: port, username: username,
            password: password, tls: tls, auth: :always}
        else
          {:fallback, adapter: Swoosh.Adapters.Local}
        end
    end
  end

  defp deliver_dynamic(email) do
    case build_config(email_settings()) do
      {:ok, config}       -> Swoosh.Mailer.deliver(email, config)
      {:fallback, config} -> Swoosh.Mailer.deliver(email, config)
      {:error, reason}    -> {:error, reason}
    end
  end

  defp from_addr do
    s = email_settings()
    name = Map.get(s, "from_name", "Nexus")
    addr = Map.get(s, "from_address", "noreply@nexus.local")
    if addr != "", do: {name, addr}, else: {"Nexus", "noreply@nexus.local"}
  end

  def base_url do
    host   = Application.get_env(:nexus, NexusWeb.Endpoint)[:url][:host] || "localhost"
    scheme = if Application.get_env(:nexus, :env) == :prod, do: "https", else: "http"
    "#{scheme}://#{host}"
  end

  defp appearance_settings do
    case Nexus.Admin.get_setting("appearance") do
      s when is_map(s) -> s
      _ -> %{}
    end
  end

  # Returns a branding context map used by all digest section renderers.
  # Extensions receive this so their HTML matches the forum's configured colours.
  def branding_context do
    app = appearance_settings()
    accent = Map.get(app, "accent_color", "#a78bfa")
    %{
      accent:      accent,
      bg:          "#0d0d14",
      card_bg:     "#13121e",
      text_1:      "#f0eeff",
      text_2:      "rgba(255,255,255,0.75)",
      text_3:      "rgba(255,255,255,0.55)",
      text_4:      "rgba(255,255,255,0.35)",
      border:      "rgba(255,255,255,0.08)",
      divider:     "rgba(255,255,255,0.08)",
    }
  end

  # ---------------------------------------------------------------------------
  # Shared HTML email layout
  # Wraps content with logo, consistent styling, and footer.
  # logo_url: nil falls back to styled site name text.
  # ---------------------------------------------------------------------------

  defp html_layout(content_html, opts \\ []) do
    gen          = general_settings()
    site_name    = Map.get(gen, "site_name", "Nexus")
    logo_url     = Map.get(gen, "logo_url")
    preview_text = Keyword.get(opts, :preview, "")
    url          = base_url()

    # Email clients cannot resolve relative URLs — make absolute.
    # If already starts with http it's a CDN/external URL, leave as-is.
    absolute_logo =
      cond do
        is_nil(logo_url) or logo_url == "" -> nil
        String.starts_with?(logo_url, "http") -> logo_url
        true -> "#{url}#{logo_url}"
      end

    logo_html = if absolute_logo do
      """
      <img src="#{absolute_logo}" alt="#{site_name}" style="max-height:40px;max-width:160px;object-fit:contain;display:block;" />
      """
    else
      """
      <span style="font-size:22px;font-weight:600;color:#f0eeff;letter-spacing:-0.5px;">#{site_name}</span>
      """
    end

    """
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8"/>
      <meta name="viewport" content="width=device-width,initial-scale=1.0"/>
      <meta name="x-apple-disable-message-reformatting"/>
      #{if preview_text != "", do: "<div style=\"display:none;max-height:0;overflow:hidden;\">#{preview_text}&nbsp;&#847;&nbsp;</div>", else: ""}
    </head>
    <body style="margin:0;padding:0;background:#0d0d14;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
      <table width="100%" cellpadding="0" cellspacing="0" style="background:#0d0d14;min-height:100vh;">
        <tr><td align="center" style="padding:40px 16px;">
          <table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;">

            <!-- Logo -->
            <tr><td style="padding-bottom:28px;">
              <a href="#{url}" style="text-decoration:none;">#{logo_html}</a>
            </td></tr>

            <!-- Card -->
            <tr><td style="background:#13121e;border:0.5px solid rgba(255,255,255,0.08);border-radius:16px;padding:36px 40px;">
              #{content_html}
            </td></tr>

            <!-- Footer -->
            <tr><td style="padding-top:24px;text-align:center;">
              <p style="margin:0;font-size:12px;color:rgba(255,255,255,0.25);line-height:1.6;">
                You're receiving this because you have an account at
                <a href="#{url}" style="color:rgba(255,255,255,0.4);text-decoration:none;">#{site_name}</a>.
              </p>
            </td></tr>

          </table>
        </td></tr>
      </table>
    </body>
    </html>
    """
  end

  defp button_html(label, url) do
    """
    <table cellpadding="0" cellspacing="0" style="margin:28px 0;">
      <tr><td style="background:#a78bfa;border-radius:10px;">
        <a href="#{url}" style="display:inline-block;padding:14px 32px;font-size:15px;font-weight:500;color:#0d0d14;text-decoration:none;border-radius:10px;letter-spacing:-0.1px;">#{label}</a>
      </td></tr>
    </table>
    """
  end

  defp h1(text) do
    """
    <h1 style="margin:0 0 8px;font-size:22px;font-weight:600;color:#f0eeff;letter-spacing:-0.4px;line-height:1.2;">#{text}</h1>
    """
  end

  defp p(text) do
    """
    <p style="margin:0 0 16px;font-size:15px;color:rgba(255,255,255,0.6);line-height:1.65;">#{text}</p>
    """
  end

  defp small(text) do
    """
    <p style="margin:20px 0 0;font-size:12px;color:rgba(255,255,255,0.25);line-height:1.6;">#{text}</p>
    """
  end

  defp divider do
    """
    <div style="height:0.5px;background:rgba(255,255,255,0.08);margin:24px 0;"></div>
    """
  end

  # Renders a 28px avatar matching the app's Avatar component exactly:
  #   - Shows the avatar image when avatar_url is set (made absolute for email clients)
  #   - Falls back to a colored initials tile using the same 12-color palette and
  #     deterministic id % 12 selection that userColor() uses in utils.js
  @avatar_colors ~w(
    #a78bfa #f472b6 #34d399 #60a5fa #fbbf24 #f87171
    #ec4899 #10b981 #fb923c #38bdf8 #a3e635 #e879f9
  )

  defp avatar_html(%{avatar_url: url, avatar_color: color, id: id, username: username})
       when is_binary(url) and url != "" do
    abs_url =
      if String.starts_with?(url, "http"), do: url, else: "#{base_url()}#{url}"
    bg = color || Enum.at(@avatar_colors, rem(id, length(@avatar_colors)))
    """
    <img src="#{abs_url}" alt="#{username}"
         width="28" height="28"
         style="width:28px;height:28px;border-radius:6px;object-fit:cover;
                vertical-align:middle;border:1px solid #{bg}33;display:inline-block;" />
    """
  end

  defp avatar_html(%{avatar_color: color, id: id, username: username}) do
    bg       = color || Enum.at(@avatar_colors, rem(id || 0, length(@avatar_colors)))
    initials = username |> String.slice(0, 2) |> String.upcase()
    """
    <div style="display:inline-flex;align-items:center;justify-content:center;
                width:28px;height:28px;border-radius:6px;background:#{bg};
                color:#fff;font-size:10px;font-weight:500;
                vertical-align:middle;flex-shrink:0;">#{initials}</div>
    """
  end

  # ---------------------------------------------------------------------------
  # Magic link
  # ---------------------------------------------------------------------------

  def send_magic_link(user, token) do
    url       = "#{base_url()}/magic-login?token=#{token}"
    gen       = general_settings()
    site_name = Map.get(gen, "site_name", "Nexus")

    content = h1("Sign in to #{site_name}") <>
              p("Hi #{user.username}, click the button below to sign in. This link expires in 15 minutes.") <>
              button_html("Sign in to #{site_name}", url) <>
              divider() <>
              small("Or copy this link into your browser: <a href=\"#{url}\" style=\"color:rgba(255,255,255,0.35);word-break:break-all;\">#{url}</a>") <>
              small("If you didn't request this, you can safely ignore this email.")

    text = """
    Hi #{user.username},

    Sign in to #{site_name} (expires in 15 minutes):
    #{url}

    If you didn't request this, ignore this email.
    """

    new()
    |> from(from_addr())
    |> to({user.username, user.email})
    |> subject("Sign in to #{site_name}")
    |> html_body(html_layout(content, preview: "Your sign-in link for #{site_name}"))
    |> text_body(text)
    |> deliver_dynamic()
  end

  # ---------------------------------------------------------------------------
  # Email verification
  # ---------------------------------------------------------------------------

  def send_verification_email(user, token) do
    url       = "#{base_url()}/verify-email?token=#{token}"
    gen       = general_settings()
    site_name = Map.get(gen, "site_name", "Nexus")

    content = h1("Verify your email address") <>
              p("Hi #{user.username}, thanks for joining #{site_name}. Click the button below to verify your email address and activate your account.") <>
              button_html("Verify email address", url) <>
              divider() <>
              small("Or copy this link into your browser: <a href=\"#{url}\" style=\"color:rgba(255,255,255,0.35);word-break:break-all;\">#{url}</a>") <>
              small("If you didn't create an account on #{site_name}, you can safely ignore this email.")

    text = """
    Hi #{user.username},

    Verify your email address for #{site_name}:
    #{url}

    If you didn't create an account, ignore this email.
    """

    new()
    |> from(from_addr())
    |> to({user.username, user.email})
    |> subject("Verify your email address")
    |> html_body(html_layout(content, preview: "Confirm your #{site_name} account"))
    |> text_body(text)
    |> deliver_dynamic()
  end

  # ---------------------------------------------------------------------------
  # Notification email
  # ---------------------------------------------------------------------------

  def send_mod_report_email(mod, report) do
    s         = Nexus.Admin.get_setting("general") || %{}
    site_name = Map.get(s, "site_name", "Nexus")
    base      = base_url()

    content_desc =
      cond do
        not is_nil(report.post_id)  -> "a post (ID #{report.post_id})"
        not is_nil(report.reply_id) -> "a reply (ID #{report.reply_id})"
        true                         -> "content"
      end

    body = """
      <p>A new report has been submitted on #{site_name}.</p>
      <p><strong>Content:</strong> #{content_desc}</p>
      <p><strong>Reason:</strong> #{report.reason}</p>
      <p><a href="#{base}/admin#moderation" style="background:#7c3aed;color:#fff;padding:8px 18px;border-radius:6px;text-decoration:none;display:inline-block;margin-top:8px;">Review in moderation panel</a></p>
    """

    new()
    |> to({mod.username, mod.email})
    |> from(from_addr())
    |> subject("[#{site_name}] New content report")
    |> html_body(html_layout(body, preview: "New content report on #{site_name}"))
    |> deliver_dynamic()
  end

  def send_notification_email(user, %{type: type, actor: actor}) do
    gen       = general_settings()
    site_name = Map.get(gen, "site_name", "Nexus")
    url       = base_url()

    {subject_line, heading, body_text} = case type do
      "reply"    -> {"#{actor} replied to your post",     "New reply",          "#{actor} replied to one of your posts on #{site_name}."}
      "reaction" -> {"#{actor} reacted to your post",     "New reaction",       "#{actor} reacted to your content on #{site_name}."}
      "mention"  -> {"#{actor} mentioned you",            "You were mentioned", "#{actor} mentioned you in a post on #{site_name}."}
      "dm"       -> {"New message from #{actor}",         "New message",        "#{actor} sent you a direct message on #{site_name}."}
      "badge"    -> {"You earned a badge on #{site_name}","Badge awarded",      "You earned a new badge on #{site_name}. Keep it up!"}
      _          -> {"New notification on #{site_name}",  "New notification",   "You have a new notification on #{site_name}."}
    end

    content = h1(heading) <>
              p(body_text) <>
              button_html("View on #{site_name}", url)

    text = """
    Hi #{user.username},

    #{body_text}

    Visit #{url} to view it.
    """

    new()
    |> from(from_addr())
    |> to({user.username, user.email})
    |> subject(subject_line)
    |> html_body(html_layout(content, preview: body_text))
    |> text_body(text)
    |> deliver_dynamic()
  end

  # ---------------------------------------------------------------------------
  # Digest email
  # ---------------------------------------------------------------------------

  def send_digest_email(user, digest) do
    gen       = general_settings()
    site_name = Map.get(gen, "site_name", "Nexus")
    url       = base_url()
    period    = digest.period_label
    sections  = digest.sections
    order     = digest.section_order
    branding  = branding_context()

    subject_line = "#{site_name} digest — #{period}"

    # Build section HTML blocks in admin-configured order, skipping empty sections
    sections_html =
      order
      |> Enum.map(fn key -> {key, Map.get(sections, key)} end)
      |> Enum.reject(fn {_k, v} ->
        is_nil(v) || v == [] ||
        # Drop extension sections whose items list is empty.
        # Built-in sections that are maps (leaderboard) are intentionally excluded
        # from this check — they use different keys (top3, etc.) not :items.
        (is_map(v) && Map.has_key?(v, "items") && Map.get(v, "items") == []) ||
        (is_map(v) && Map.has_key?(v, :items)  && Map.get(v, :items)  == [])
      end)
      |> Enum.map(fn {key, data} -> render_digest_section(key, data, url, site_name, branding) end)
      |> Enum.join("\n")

    intro_html =
      h1("#{site_name} digest") <>
      p("Here's what happened in the community #{period}.") <>
      divider()

    content = intro_html <> sections_html <> button_html("View #{site_name}", url)

    text = build_digest_text(user, digest, site_name, url)

    new()
    |> from(from_addr())
    |> to({user.username, user.email})
    |> subject(subject_line)
    |> html_body(html_layout(content, preview: "Your #{site_name} digest for #{period}"))
    |> text_body(text)
    |> deliver_dynamic()
  end

  defp render_digest_section("posts", posts, url, _site_name, _branding) when is_list(posts) and posts != [] do
    rows =
      posts
      |> Enum.with_index(1)
      |> Enum.map(fn {p, i} ->
        post_url = "#{url}/post/#{p.id}"
        av = avatar_html(%{avatar_url: p.avatar_url, avatar_color: p.avatar_color, id: p.author_id, username: p.author})
        """
        <tr>
          <td style="padding:10px 0;border-bottom:0.5px solid rgba(255,255,255,0.06);">
            <table cellpadding="0" cellspacing="0" width="100%">
              <tr>
                <td style="width:24px;font-size:13px;color:rgba(255,255,255,0.2);font-weight:500;vertical-align:top;padding-top:2px;">#{i}.</td>
                <td>
                  <a href="#{post_url}" style="font-size:14px;font-weight:500;color:#f0eeff;text-decoration:none;display:block;margin-bottom:6px;">#{p.title}</a>
                  <table cellpadding="0" cellspacing="0"><tr>
                    <td style="vertical-align:middle;padding-right:6px;">#{av}</td>
                    <td style="vertical-align:middle;font-size:11px;color:rgba(255,255,255,0.3);">#{p.author} &nbsp;·&nbsp; #{p.space_name} &nbsp;·&nbsp; #{p.reply_count} replies &nbsp;·&nbsp; #{p.reaction_count} hearts</td>
                  </tr></table>
                </td>
              </tr>
            </table>
          </td>
        </tr>
        """
      end)
      |> Enum.join()

    """
    <p style="margin:0 0 12px;font-size:11px;font-weight:500;color:rgba(255,255,255,0.3);text-transform:uppercase;letter-spacing:0.8px;">Top posts</p>
    <table cellpadding="0" cellspacing="0" width="100%" style="margin-bottom:24px;">#{rows}</table>
    #{divider()}
    """
  end

  defp render_digest_section("leaderboard", %{top3: top3, points_name: points_name}, _url, _site_name, branding) when top3 != [] do
    medals = ["🥇", "🥈", "🥉"]
    rows =
      top3
      |> Enum.with_index()
      |> Enum.map(fn {u, i} ->
        av = avatar_html(%{avatar_url: u.avatar_url, avatar_color: u.avatar_color, id: u.user_id, username: u.username})
        """
        <tr>
          <td style="padding:8px 0;border-bottom:0.5px solid rgba(255,255,255,0.06);">
            <table cellpadding="0" cellspacing="0" width="100%"><tr>
              <td style="width:28px;font-size:16px;vertical-align:middle;">#{Enum.at(medals, i, "")}</td>
              <td style="vertical-align:middle;padding-right:8px;">#{av}</td>
              <td style="font-size:13px;color:rgba(255,255,255,0.75);font-weight:500;vertical-align:middle;">#{u.username}</td>
              <td style="text-align:right;font-size:13px;color:#{branding.accent};font-weight:500;vertical-align:middle;">#{u.score} #{points_name}</td>
            </tr></table>
          </td>
        </tr>
        """
      end)
      |> Enum.join()

    """
    <p style="margin:0 0 12px;font-size:11px;font-weight:500;color:rgba(255,255,255,0.3);text-transform:uppercase;letter-spacing:0.8px;">Leaderboard</p>
    <table cellpadding="0" cellspacing="0" width="100%" style="margin-bottom:24px;">#{rows}</table>
    #{divider()}
    """
  end

  defp render_digest_section("badges", badges, _url, _site_name, _branding) when is_list(badges) and badges != [] do
    rows =
      Enum.map(badges, fn b ->
        holders = Enum.join(b.holders, ", ")
        """
        <tr>
          <td style="padding:8px 0;border-bottom:0.5px solid rgba(255,255,255,0.06);">
            <table cellpadding="0" cellspacing="0" width="100%"><tr>
              <td style="width:28px;">
                <div style="width:24px;height:24px;border-radius:6px;background:#{b.badge_color}22;display:inline-flex;align-items:center;justify-content:center;">
                  <span style="font-size:11px;color:#{b.badge_color};">●</span>
                </div>
              </td>
              <td>
                <span style="font-size:13px;font-weight:500;color:#{b.badge_color};">#{b.badge_name}</span>
                <span style="font-size:11px;color:rgba(255,255,255,0.35);margin-left:8px;">#{holders}</span>
              </td>
            </tr></table>
          </td>
        </tr>
        """
      end)
      |> Enum.join()

    """
    <p style="margin:0 0 12px;font-size:11px;font-weight:500;color:rgba(255,255,255,0.3);text-transform:uppercase;letter-spacing:0.8px;">Badges awarded</p>
    <table cellpadding="0" cellspacing="0" width="100%" style="margin-bottom:24px;">#{rows}</table>
    #{divider()}
    """
  end

  defp render_digest_section("members", members, _url, _site_name, _branding) when is_list(members) and members != [] do
    count = length(members)
    rows =
      Enum.map(members, fn m ->
        av = avatar_html(%{avatar_url: m.avatar_url, avatar_color: m.avatar_color, id: m.id, username: m.username})
        """
        <tr>
          <td style="padding:5px 0;">
            <table cellpadding="0" cellspacing="0"><tr>
              <td style="vertical-align:middle;padding-right:8px;">#{av}</td>
              <td style="font-size:13px;color:rgba(255,255,255,0.65);vertical-align:middle;">#{m.username}</td>
            </tr></table>
          </td>
        </tr>
        """
      end)
      |> Enum.join()

    """
    <p style="margin:0 0 12px;font-size:11px;font-weight:500;color:rgba(255,255,255,0.3);text-transform:uppercase;letter-spacing:0.8px;">New members (#{count})</p>
    <table cellpadding="0" cellspacing="0" width="100%" style="margin-bottom:24px;">#{rows}</table>
    #{divider()}
    """
  end

  defp render_digest_section("spaces", spaces, _url, _site_name, _branding) when is_list(spaces) and spaces != [] do
    max_count = spaces |> Enum.map(& &1.post_count) |> Enum.max(fn -> 1 end)

    rows =
      Enum.map(spaces, fn s ->
        pct = max(4, round(s.post_count / max_count * 100))
        """
        <tr>
          <td style="padding:6px 0;">
            <table cellpadding="0" cellspacing="0" width="100%"><tr>
              <td style="width:100px;font-size:12px;color:rgba(255,255,255,0.5);">#{s.name}</td>
              <td>
                <div style="height:4px;border-radius:2px;background:rgba(255,255,255,0.06);">
                  <div style="height:4px;border-radius:2px;background:#{s.color};width:#{pct}%;"></div>
                </div>
              </td>
              <td style="width:36px;text-align:right;font-size:11px;color:#{s.color};padding-left:8px;">#{s.post_count}</td>
            </tr></table>
          </td>
        </tr>
        """
      end)
      |> Enum.join()

    """
    <p style="margin:0 0 12px;font-size:11px;font-weight:500;color:rgba(255,255,255,0.3);text-transform:uppercase;letter-spacing:0.8px;">Trending spaces</p>
    <table cellpadding="0" cellspacing="0" width="100%" style="margin-bottom:24px;">#{rows}</table>
    #{divider()}
    """
  end

  # ─────────────────────────────────────────────────────────────────────────
  # Structured-data extension sections.
  #
  # Extensions return %{title, layout, items, cta} from handle_digest_section/3
  # (or /4 with branding). The mailer dispatches on `layout` to the appropriate
  # renderer below. Five layouts are supported:
  #
  #   list         — ranked list with optional badge + sublabel per item
  #   leaderboard  — top N with medal icons and right-aligned values
  #   stat_bars    — horizontal bar chart scaled to the highest value
  #   pill_grid    — wrapping colored pills (tags, genres, categories)
  #   card         — thumbnail-rich cards (book covers, game covers, videos)
  #
  # The optional `cta` is rendered as a small footer button below the items.
  # All layouts share the same section header style as the built-in sections.
  # Extensions writing the structured shape never write inline styles — the
  # mailer applies all branding here.
  #
  # Section keys arrive string-keyed (deep_stringify in Digest.collect_extension_sections).
  # ─────────────────────────────────────────────────────────────────────────
  defp render_digest_section(_key, %{"items" => items, "layout" => layout} = section, url, _site_name, branding)
       when is_list(items) and items != [] do
    title = section["title"] || ""
    cta   = section["cta"]
    render_layout(layout, title, items, cta, url, branding)
  end

  # Default layout when extension returns items without an explicit `layout` key.
  defp render_digest_section(_key, %{"items" => items} = section, url, _site_name, branding)
       when is_list(items) and items != [] do
    title = section["title"] || ""
    cta   = section["cta"]
    render_layout("list", title, items, cta, url, branding)
  end

  # Extension pre-rendered HTML — injected verbatim. Extensions taking this
  # path are responsible for matching the email's visual design themselves
  # (use branding map for colors). Reserved for sections that genuinely need
  # custom layout — image-heavy summaries, chart visualisations, etc.
  defp render_digest_section(_key, %{"_rendered_html" => html}, _url, _site_name, _branding) when is_binary(html) and html != "" do
    html
  end

  # Fallback for empty/nil sections
  defp render_digest_section(_key, _data, _url, _site_name, _branding), do: ""

  # ─────────────────────────────────────────────────────────────────────────
  # Layout renderers — consume the structured shape, produce HTML rows.
  # Each layout uses the same section header + table + divider scaffolding
  # as the built-in renderers, so extension and built-in sections look
  # visually identical at the section-shape level.
  # ─────────────────────────────────────────────────────────────────────────

  defp render_layout("list", title, items, cta, url, branding) do
    rows =
      items
      |> Enum.with_index(1)
      |> Enum.map(fn {item, i} -> render_list_item(item, i, url, branding) end)
      |> Enum.join()

    section_wrapper(title, rows, cta, url, branding)
  end

  defp render_layout("leaderboard", title, items, cta, url, branding) do
    medals = ["🥇", "🥈", "🥉"]
    rows =
      items
      |> Enum.with_index()
      |> Enum.map(fn {item, i} ->
        medal = Enum.at(medals, i, "")
        label = item_label_with_url(item, url, branding)
        value = item["value"]
        """
        <tr>
          <td style="padding:8px 0;border-bottom:0.5px solid rgba(255,255,255,0.06);">
            <table cellpadding="0" cellspacing="0" width="100%"><tr>
              <td style="width:28px;font-size:16px;vertical-align:middle;">#{medal}</td>
              <td style="font-size:13px;color:rgba(255,255,255,0.75);font-weight:500;vertical-align:middle;">#{label}</td>
              #{if value, do: ~s|<td style="text-align:right;font-size:13px;color:#{branding.accent};font-weight:500;vertical-align:middle;">#{escape(to_string(value))}</td>|, else: ""}
            </tr></table>
          </td>
        </tr>
        """
      end)
      |> Enum.join()

    section_wrapper(title, rows, cta, url, branding)
  end

  defp render_layout("stat_bars", title, items, cta, url, branding) do
    # Scale bars to the highest numeric `value`; falls back to label count if
    # values aren't numeric.
    max_val =
      items
      |> Enum.map(&numeric_value/1)
      |> Enum.max(fn -> 1 end)
      |> max(1)

    rows =
      Enum.map(items, fn item ->
        n = numeric_value(item)
        pct = max(4, round(n / max_val * 100))
        color = item["badge_color"] || branding.accent
        label = item_label_with_url(item, url, branding)
        value_display = item["value"] || n
        """
        <tr>
          <td style="padding:6px 0;">
            <table cellpadding="0" cellspacing="0" width="100%"><tr>
              <td style="width:120px;font-size:12px;color:rgba(255,255,255,0.5);">#{label}</td>
              <td>
                <div style="height:4px;border-radius:2px;background:rgba(255,255,255,0.06);">
                  <div style="height:4px;border-radius:2px;background:#{color};width:#{pct}%;"></div>
                </div>
              </td>
              <td style="width:48px;text-align:right;font-size:11px;color:#{color};padding-left:8px;">#{escape(to_string(value_display))}</td>
            </tr></table>
          </td>
        </tr>
        """
      end)
      |> Enum.join()

    section_wrapper(title, rows, cta, url, branding)
  end

  defp render_layout("pill_grid", title, items, cta, url, branding) do
    # All pills wrap into one cell; the section-wrapper table provides the
    # outer header + divider.
    pills =
      Enum.map(items, fn item ->
        color = item["badge_color"] || branding.accent
        bg    = color <> "22"   # hex w/ alpha 0x22 for translucent fill
        label = escape(to_string(item["label"] || ""))
        content =
          case item["url"] do
            u when is_binary(u) and u != "" ->
              ~s|<a href="#{absolute_url(u, url)}" style="text-decoration:none;">#{label}</a>|
            _ ->
              label
          end
        ~s|<span style="display:inline-block;padding:4px 10px;margin:0 6px 6px 0;border-radius:14px;background:#{bg};color:#{color};font-size:12px;font-weight:500;">#{content}</span>|
      end)
      |> Enum.join()

    row = """
    <tr>
      <td style="padding:6px 0;line-height:1.8;">
        #{pills}
      </td>
    </tr>
    """

    section_wrapper(title, row, cta, url, branding)
  end

  defp render_layout("card", title, items, cta, url, branding) do
    # Thumbnail-rich cards — for content where a visual matters (game covers,
    # book covers, video thumbnails). Each item renders as a 64px-wide image
    # on the left + label/sublabel/value on the right.
    rows =
      Enum.map(items, fn item ->
        image = item["image_url"]
        label = item_label_with_url(item, url, branding)
        sublabel = item["sublabel"]
        badge_html = badge_pill(item, branding)
        value = item["value"]
        thumb =
          if is_binary(image) and image != "" do
            ~s|<img src="#{absolute_url(image, url)}" width="64" height="64" alt="" style="display:block;width:64px;height:64px;border-radius:8px;object-fit:cover;background:rgba(255,255,255,0.04);"/>|
          else
            ~s|<div style="width:64px;height:64px;border-radius:8px;background:rgba(255,255,255,0.04);"></div>|
          end

        """
        <tr>
          <td style="padding:10px 0;border-bottom:0.5px solid rgba(255,255,255,0.06);">
            <table cellpadding="0" cellspacing="0" width="100%"><tr>
              <td style="width:64px;vertical-align:top;padding-right:12px;">#{thumb}</td>
              <td style="vertical-align:top;">
                <div style="font-size:14px;font-weight:500;color:#f0eeff;margin-bottom:4px;">#{label}#{if badge_html != "", do: " " <> badge_html, else: ""}</div>
                #{if sublabel, do: ~s|<div style="font-size:12px;color:rgba(255,255,255,0.45);">#{escape(to_string(sublabel))}</div>|, else: ""}
                #{if value, do: ~s|<div style="font-size:11px;color:#{branding.accent};margin-top:4px;">#{escape(to_string(value))}</div>|, else: ""}
              </td>
            </tr></table>
          </td>
        </tr>
        """
      end)
      |> Enum.join()

    section_wrapper(title, rows, cta, url, branding)
  end

  # Unknown layout — fall back to list.
  defp render_layout(_other, title, items, cta, url, branding) do
    render_layout("list", title, items, cta, url, branding)
  end

  # ─────────────────────────────────────────────────────────────────────────
  # Layout helpers
  # ─────────────────────────────────────────────────────────────────────────

  # Standard section scaffolding: header, table of rows, optional CTA button,
  # trailing divider. Matches the visual idiom of the built-in section
  # renderers exactly so extension sections look indistinguishable from
  # built-ins at the chrome level.
  defp section_wrapper(title, rows_html, cta, base_url, branding) do
    cta_html =
      case cta do
        %{"label" => label, "url" => href} when is_binary(label) and is_binary(href) ->
          """
          <table cellpadding="0" cellspacing="0" style="margin:4px 0 16px;"><tr>
            <td style="padding:8px 14px;border-radius:6px;background:#{branding.accent}22;">
              <a href="#{absolute_url(href, base_url)}" style="font-size:12px;font-weight:500;color:#{branding.accent};text-decoration:none;">#{escape(label)} →</a>
            </td>
          </tr></table>
          """
        _ -> ""
      end

    """
    <p style="margin:0 0 12px;font-size:11px;font-weight:500;color:rgba(255,255,255,0.3);text-transform:uppercase;letter-spacing:0.8px;">#{escape(title)}</p>
    <table cellpadding="0" cellspacing="0" width="100%" style="margin-bottom:#{if cta_html == "", do: 24, else: 8}px;">#{rows_html}</table>
    #{cta_html}
    #{divider()}
    """
  end

  # Renders a single row for the "list" layout: index, label (linked if url),
  # optional badge, optional sublabel.
  defp render_list_item(item, index, base_url, branding) do
    label = item_label_with_url(item, base_url, branding)
    sublabel = item["sublabel"]
    badge_html = badge_pill(item, branding)
    value = item["value"]
    """
    <tr>
      <td style="padding:10px 0;border-bottom:0.5px solid rgba(255,255,255,0.06);">
        <table cellpadding="0" cellspacing="0" width="100%">
          <tr>
            <td style="width:24px;font-size:13px;color:rgba(255,255,255,0.2);font-weight:500;vertical-align:top;padding-top:2px;">#{index}.</td>
            <td>
              <div style="font-size:14px;font-weight:500;color:#f0eeff;margin-bottom:#{if sublabel, do: 4, else: 0}px;">#{label}#{if badge_html != "", do: " " <> badge_html, else: ""}</div>
              #{if sublabel, do: ~s|<div style="font-size:11px;color:rgba(255,255,255,0.3);">#{escape(to_string(sublabel))}</div>|, else: ""}
            </td>
            #{if value, do: ~s|<td style="text-align:right;font-size:12px;color:#{branding.accent};font-weight:500;vertical-align:top;padding-top:2px;white-space:nowrap;">#{escape(to_string(value))}</td>|, else: ""}
          </tr>
        </table>
      </td>
    </tr>
    """
  end

  # Renders the item label as either an anchor or plain text depending on
  # whether the item has a `url`. URL escaping: only the href value goes
  # through absolute_url+escape; label text always escapes.
  defp item_label_with_url(item, base_url, _branding) do
    label_text = escape(to_string(item["label"] || ""))
    case item["url"] do
      u when is_binary(u) and u != "" ->
        ~s|<a href="#{absolute_url(u, base_url)}" style="color:#f0eeff;text-decoration:none;">#{label_text}</a>|
      _ ->
        label_text
    end
  end

  # Renders the optional badge pill (used by list and card layouts). Empty
  # string when no badge is set.
  defp badge_pill(item, branding) do
    case item["badge"] do
      b when is_binary(b) and b != "" ->
        color = item["badge_color"] || branding.accent
        bg    = color <> "22"
        ~s|<span style="display:inline-block;padding:1px 6px;margin-left:4px;border-radius:8px;background:#{bg};color:#{color};font-size:10px;font-weight:600;letter-spacing:0.3px;text-transform:uppercase;vertical-align:middle;">#{escape(b)}</span>|
      _ ->
        ""
    end
  end

  # Coerces an item's `value` field to a number for bar-scaling. Accepts
  # raw integers, floats, strings starting with digits ("1,204 logs"),
  # and falls back to 1 for non-numeric values.
  defp numeric_value(item) do
    case item["value"] do
      n when is_integer(n) -> n
      f when is_float(f)   -> f
      s when is_binary(s)  ->
        case Integer.parse(String.replace(s, ~r/[^\d\-]/, "")) do
          {n, _} -> n
          :error -> 1
        end
      _ -> 1
    end
  end

  # Resolves a possibly-relative URL against the site's base URL. Lets
  # extensions return either "/path/to/thing" or "https://elsewhere.com/x".
  defp absolute_url("http" <> _ = absolute, _base), do: absolute
  defp absolute_url("//" <> _ = protocol_relative, _base), do: protocol_relative
  defp absolute_url(<<"/", _::binary>> = path, base), do: base <> path
  defp absolute_url(other, _base), do: other

  # Conservative HTML escaping for text that may appear inside an attribute
  # OR element content. Strips the five XML special characters.
  defp escape(nil), do: ""
  defp escape(s) when is_binary(s) do
    s
    |> String.replace("&", "&amp;")
    |> String.replace("<", "&lt;")
    |> String.replace(">", "&gt;")
    |> String.replace("\"", "&quot;")
    |> String.replace("'", "&#39;")
  end
  defp escape(other), do: escape(to_string(other))

  defp build_digest_text(user, digest, site_name, url) do
    period = digest.period_label
    order  = digest.section_order
    sects  = digest.sections

    lines = ["Hi #{user.username},", "", "Here's what happened in #{site_name} #{period}:", ""]

    lines = lines ++ Enum.flat_map(order, fn key ->
      case {key, Map.get(sects, key)} do
        {"posts", posts} when is_list(posts) and posts != [] ->
          post_lines = Enum.with_index(posts, 1) |> Enum.map(fn {p, i} ->
            "#{i}. #{p.title} (#{p.reply_count} replies, #{p.reaction_count} hearts) — #{url}/post/#{p.id}"
          end)
          ["TOP POSTS", ""] ++ post_lines ++ [""]
        {"leaderboard", %{top3: top3, points_name: pn}} when top3 != [] ->
          lb_lines = Enum.with_index(top3, 1) |> Enum.map(fn {u, i} ->
            "#{i}. #{u.username} — #{u.score} #{pn}"
          end)
          ["LEADERBOARD", ""] ++ lb_lines ++ [""]
        {"badges", badges} when is_list(badges) and badges != [] ->
          badge_lines = Enum.map(badges, fn b ->
            "#{b.badge_name}: #{Enum.join(b.holders, ", ")}"
          end)
          ["BADGES AWARDED", ""] ++ badge_lines ++ [""]
        {"members", members} when is_list(members) and members != [] ->
          names = Enum.map_join(members, ", ", & &1.username)
          ["NEW MEMBERS", names, ""]
        {"spaces", spaces} when is_list(spaces) and spaces != [] ->
          space_lines = Enum.map(spaces, fn s -> "#{s.name}: #{s.post_count} posts" end)
          ["TRENDING SPACES", ""] ++ space_lines ++ [""]
        # Structured-data extension sections: %{"title", "items", optional "cta"}.
        # Each item renders as a plain-text line using label / sublabel / value.
        # Layout-specific HTML niceties (medals, bars, pills) collapse to plain
        # text — the structured shape carries all the data we need to do this.
        {_key, %{"items" => items} = section} when is_list(items) and items != [] ->
          title = (section["title"] || "") |> String.upcase()
          ext_lines = Enum.with_index(items, 1) |> Enum.map(fn {item, i} ->
            label    = to_string(item["label"] || "")
            value    = item["value"]
            sublabel = item["sublabel"]
            url_part = case item["url"] do
              u when is_binary(u) and u != "" -> " — #{absolute_url(u, url)}"
              _ -> ""
            end
            parts = [
              "#{i}. #{label}",
              if(value,    do: " (#{value})", else: ""),
              if(sublabel, do: " — #{sublabel}", else: ""),
              url_part
            ]
            Enum.join(parts)
          end)
          cta_line = case section["cta"] do
            %{"label" => l, "url" => u} when is_binary(l) and is_binary(u) ->
              ["", "#{l}: #{absolute_url(u, url)}"]
            _ -> []
          end
          [title, ""] ++ ext_lines ++ cta_line ++ [""]
        # _rendered_html extensions can't degrade to text automatically.
        # Best we can do: emit the title (if known via section_order key) and
        # a placeholder line so the recipient knows something was there.
        {key, %{"_rendered_html" => html}} when is_binary(html) and html != "" ->
          [String.upcase(to_string(key)), "(see HTML version)", ""]
        _ -> []
      end
    end)

    lines = lines ++ ["Visit #{site_name}: #{url}", ""]
    Enum.join(lines, "\n")
  end
end


