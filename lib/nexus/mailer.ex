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

  def send_magic_link(user, token) do
    url = "#{base_url()}/api/v1/auth/magic?token=#{token}"
    new()
    |> from(from_addr())
    |> to({user.username, user.email})
    |> subject("Your sign-in link")
    |> text_body("Hi #{user.username},\n\nSign in here (expires in 15 minutes):\n#{url}\n\nIf you didn't request this, ignore this email.\n")
    |> deliver_dynamic()
  end

  def send_verification_email(user, token) do
    url = "#{base_url()}/api/v1/auth/verify-email?token=#{token}"
    new()
    |> from(from_addr())
    |> to({user.username, user.email})
    |> subject("Verify your email address")
    |> text_body("Hi #{user.username},\n\nVerify your email:\n#{url}\n")
    |> deliver_dynamic()
  end

  def send_notification_email(user, %{type: type, actor: actor}) do
    msg = case type do
      "reply"    -> "#{actor} replied to your post."
      "reaction" -> "#{actor} reacted to your post."
      "mention"  -> "#{actor} mentioned you."
      "dm"       -> "#{actor} sent you a message."
      _          -> "You have a new notification."
    end
    new()
    |> from(from_addr())
    |> to({user.username, user.email})
    |> subject("New notification — #{actor}")
    |> text_body("Hi #{user.username},\n\n#{msg}\n\nVisit #{base_url()} to view it.\n")
    |> deliver_dynamic()
  end
end
