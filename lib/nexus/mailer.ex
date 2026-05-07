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

  defp base_url do
    host   = Application.get_env(:nexus, NexusWeb.Endpoint)[:url][:host] || "localhost"
    scheme = if Application.get_env(:nexus, :env) == :prod, do: "https", else: "http"
    "#{scheme}://#{host}"
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

    logo_html = if logo_url && logo_url != "" do
      """
      <img src="#{logo_url}" alt="#{site_name}" style="max-height:40px;max-width:160px;object-fit:contain;display:block;" />
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
end

