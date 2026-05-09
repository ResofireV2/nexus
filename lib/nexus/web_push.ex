defmodule Nexus.WebPush do
  @moduledoc """
  Sends Web Push notifications per RFC 8030 (Web Push Protocol),
  RFC 8291 (Message Encryption), and RFC 8292 (VAPID).

  Uses only OTP :crypto and the JOSE library (a transitive dependency of
  Joken, which is already in mix.exs). No additional dependencies.

  ## How it works

  1. Build the plaintext JSON payload.
  2. Encrypt it with ECDH + HKDF + AES-128-GCM (RFC 8291).
  3. Build a VAPID JWT signed with ES256 (RFC 8292).
  4. POST to the subscription endpoint via :req.
  """

  @doc """
  Send a web push notification.

  - `endpoint`     — the push endpoint URL from the browser subscription
  - `p256dh`       — the browser's ECDH public key (base64url, no padding)
  - `auth`         — the browser's auth secret (base64url, no padding)
  - `vapid_public` — server VAPID public key (base64url, no padding)
  - `vapid_private`— server VAPID private key (base64url, no padding)
  - `payload`      — JSON string to send (already encoded)
  """
  def send(endpoint, p256dh, auth, vapid_public, vapid_private, payload) do
    with {:ok, encrypted, salt, server_pub} <- encrypt(payload, p256dh, auth),
         {:ok, vapid_header} <- build_vapid_header(endpoint, vapid_public, vapid_private) do

      crypto_key = "dh=#{Base.url_encode64(server_pub, padding: false)}"
      encryption  = "salt=#{Base.url_encode64(salt, padding: false)}"

      headers = [
        {"Content-Type", "application/octet-stream"},
        {"Content-Encoding", "aesgcm"},
        {"Encryption", encryption},
        {"Crypto-Key", "#{crypto_key};#{vapid_header.crypto_key}"},
        {"Authorization", vapid_header.authorization},
        {"TTL", "86400"},
        {"Urgency", "high"},
        {"Topic", "nexus-notification"}
      ]

      case Req.post(endpoint, body: encrypted, headers: headers) do
        {:ok, %{status: status}} when status in 200..299 -> :ok
        {:ok, %{status: 410}}  -> {:error, :subscription_expired}
        {:ok, %{status: 404}}  -> {:error, :subscription_not_found}
        {:ok, %{status: code}} -> {:error, {:http_error, code}}
        {:error, reason}       -> {:error, {:request_failed, reason}}
      end
    end
  end

  # ---------------------------------------------------------------------------
  # RFC 8291 — Message Encryption
  # ---------------------------------------------------------------------------

  defp encrypt(plaintext, p256dh_b64, auth_b64) do
    # Decode subscriber keys
    subscriber_pub = Base.url_decode64!(p256dh_b64, padding: false)
    auth_secret    = Base.url_decode64!(auth_b64, padding: false)

    # Generate ephemeral server ECDH keypair
    {server_pub, server_priv} = :crypto.generate_key(:ecdh, :prime256v1)

    # ECDH shared secret
    shared_secret = :crypto.compute_key(:ecdh, subscriber_pub, server_priv, :prime256v1)

    # Random salt (16 bytes)
    salt = :crypto.strong_rand_bytes(16)

    # HKDF-SHA-256 to derive pseudorandom key from auth secret
    prk = hkdf_extract(:sha256, auth_secret, shared_secret)

    # RFC 8291 §3.4 context string:
    # "P-256\0" + uint16_be(len(receiver_pub)) + receiver_pub
    #           + uint16_be(len(sender_pub))   + sender_pub
    len_sub = byte_size(subscriber_pub)
    len_srv = byte_size(server_pub)

    context = "P-256\0" <>
              <<len_sub::unsigned-big-integer-size(16)>> <> subscriber_pub <>
              <<len_srv::unsigned-big-integer-size(16)>> <> server_pub

    key_info   = "Content-Encoding: aesgcm\0" <> context
    nonce_info = "Content-Encoding: nonce\0"  <> context

    # HKDF-Expand to derive CEK (16 bytes) and nonce (12 bytes) from PRK + salt
    prk2       = hkdf_extract(:sha256, salt, prk)
    cek        = hkdf_expand(:sha256, prk2, key_info,   16)
    nonce      = hkdf_expand(:sha256, prk2, nonce_info, 12)

    # Pad plaintext: 2-byte big-endian padding length (0) + plaintext
    padded = <<0, 0>> <> plaintext

    # AES-128-GCM encrypt
    {ciphertext, tag} =
      :crypto.crypto_one_time_aead(
        :aes_128_gcm,
        cek,
        nonce,
        padded,
        "",
        true
      )

    {:ok, ciphertext <> tag, salt, server_pub}
  rescue
    e -> {:error, Exception.message(e)}
  end

  # ---------------------------------------------------------------------------
  # RFC 8292 — VAPID
  # ---------------------------------------------------------------------------

  defp build_vapid_header(endpoint, vapid_public_b64, vapid_private_b64) do
    # Extract audience (scheme + host) from endpoint URL
    uri      = URI.parse(endpoint)
    audience = "#{uri.scheme}://#{uri.host}"
    exp      = System.system_time(:second) + 12 * 3600

    # Use the configured from_address as the VAPID contact — push services
    # use this to contact the server operator if there's a problem.
    # Falls back to a generic address if not configured.
    contact = case Nexus.Admin.get_setting("email") do
      %{"from_address" => addr} when is_binary(addr) and addr != "" -> "mailto:#{addr}"
      _ -> "mailto:admin@#{uri.host}"
    end

    claims = %{"aud" => audience, "exp" => exp, "sub" => contact}

    # Decode raw private key bytes
    private_bytes = Base.url_decode64!(vapid_private_b64, padding: false)
    public_bytes  = Base.url_decode64!(vapid_public_b64, padding: false)

    # Build a JWK from the raw EC P-256 key bytes for JOSE
    # public_bytes is the uncompressed point: 0x04 | x (32) | y (32)
    <<4, x::binary-size(32), y::binary-size(32)>> = public_bytes

    jwk = JOSE.JWK.from_map(%{
      "kty" => "EC",
      "crv" => "P-256",
      "x"   => Base.url_encode64(x, padding: false),
      "y"   => Base.url_encode64(y, padding: false),
      "d"   => Base.url_encode64(private_bytes, padding: false)
    })

    # Sign with ES256
    jws    = JOSE.JWS.from_map(%{"alg" => "ES256"})
    {_, signed} = JOSE.JWT.sign(jwk, jws, claims) |> JOSE.JWS.compact()

    authorization = "vapid t=#{signed},k=#{vapid_public_b64}"
    crypto_key    = "p256ecdsa=#{vapid_public_b64}"

    {:ok, %{authorization: authorization, crypto_key: crypto_key}}
  rescue
    e -> {:error, Exception.message(e)}
  end

  # ---------------------------------------------------------------------------
  # HKDF helpers (RFC 5869)
  # ---------------------------------------------------------------------------

  # HKDF-Extract: PRK = HMAC-Hash(salt, IKM)
  defp hkdf_extract(hash, salt, ikm) do
    :crypto.mac(:hmac, hash, salt, ikm)
  end

  # HKDF-Expand: OKM = T(1) || T(2) || ... truncated to length
  # T(n) = HMAC-Hash(PRK, T(n-1) || info || n)
  defp hkdf_expand(hash, prk, info, length) do
    # Single round is sufficient for length <= hash_len (32 for SHA-256)
    t1 = :crypto.mac(:hmac, hash, prk, info <> <<1>>)
    binary_part(t1, 0, length)
  end
end
