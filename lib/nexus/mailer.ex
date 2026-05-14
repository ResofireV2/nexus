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

  # ---------------------------------------------------------------------------
  # Magic link
  # ---------------------------------------------------------------------------

  def send_magic_link(user, token) do
    url       = "#{base_url()}/api/v1/auth/magic?token=#{token}"
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
        (is_map(v) && Map.get(v, "items", Map.get(v, :items, [])) == [])
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
        """
        <tr>
          <td style="padding:10px 0;border-bottom:0.5px solid rgba(255,255,255,0.06);">
            <table cellpadding="0" cellspacing="0" width="100%">
              <tr>
                <td style="width:24px;font-size:13px;color:rgba(255,255,255,0.2);font-weight:500;vertical-align:top;padding-top:2px;">#{i}.</td>
                <td>
                  <a href="#{post_url}" style="font-size:14px;font-weight:500;color:#f0eeff;text-decoration:none;display:block;margin-bottom:4px;">#{p.title}</a>
                  <span style="font-size:11px;color:rgba(255,255,255,0.3);">#{p.space_name} &nbsp;·&nbsp; #{p.reply_count} replies &nbsp;·&nbsp; #{p.reaction_count} hearts &nbsp;·&nbsp; by #{p.author}</span>
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
        """
        <tr>
          <td style="padding:8px 0;border-bottom:0.5px solid rgba(255,255,255,0.06);">
            <table cellpadding="0" cellspacing="0" width="100%"><tr>
              <td style="width:28px;font-size:16px;">#{Enum.at(medals, i, "")}</td>
              <td style="font-size:13px;color:rgba(255,255,255,0.75);font-weight:500;">#{u.username}</td>
              <td style="text-align:right;font-size:13px;color:#{branding.accent};font-weight:500;">#{u.score} #{points_name}</td>
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
    names = members |> Enum.map(& &1.username) |> Enum.join(", ")
    count = length(members)

    """
    <p style="margin:0 0 8px;font-size:11px;font-weight:500;color:rgba(255,255,255,0.3);text-transform:uppercase;letter-spacing:0.8px;">New members</p>
    <p style="margin:0 0 24px;font-size:13px;color:rgba(255,255,255,0.55);">Welcome to #{count} new member#{if count == 1, do: "", else: "s"}: #{names}</p>
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

  # Extension pre-rendered HTML — injected verbatim
  defp render_digest_section(_key, %{"_rendered_html" => html}, _url, _site_name, _branding) when is_binary(html) and html != "" do
    html
  end


  # Fallback for empty/nil sections
  defp render_digest_section(_key, _data, _url, _site_name, _branding), do: ""

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
        _ -> []
      end
    end)

    lines = lines ++ ["Visit #{site_name}: #{url}", ""]
    Enum.join(lines, "\n")
  end
end


