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

      turnstile_enabled?() && !turnstile_verified?(params) ->
        log_blocked(ip, email, username, "turnstile", nil)
        {:block, "Human verification failed. Please try again."}

      disposable_email?(email) ->
        log_blocked(ip, email, username, "disposable_email", nil)
        {:block, "Disposable email addresses are not permitted. Please use a permanent email address."}

      suspicious_username?(username) ->
        log_blocked(ip, email, username, "suspicious_username", nil)
        {:block, "That username is not allowed. Please choose a different username."}

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

  defp turnstile_enabled? do
    cfg = Nexus.Admin.get_setting("anti_spam") || %{}
    cfg["turnstile_enabled"] == true and not is_nil_or_empty(cfg["turnstile_secret_key"])
  end

  defp turnstile_verified?(params) do
    token = Map.get(params, "cf_turnstile_response", "") |> to_string() |> String.trim()
    if token == "" do
      false
    else
      cfg        = Nexus.Admin.get_setting("anti_spam") || %{}
      secret_key = cfg["turnstile_secret_key"] || ""

      case Req.post("https://challenges.cloudflare.com/turnstile/v0/siteverify",
             form: [secret: secret_key, response: token],
             receive_timeout: 5_000) do
        {:ok, %{status: 200, body: %{"success" => true}}} ->
          true

        {:ok, %{status: 200, body: body}} ->
          Logger.warning("Turnstile verification failed: #{inspect(body["error-codes"])}")
          false

        other ->
          Logger.warning("Turnstile request error: #{inspect(other)}")
          # Fail open — don't block registrations if Cloudflare is unreachable
          true
      end
    end
  end

  defp is_nil_or_empty(nil), do: true
  defp is_nil_or_empty(""),  do: true
  defp is_nil_or_empty(_),   do: false

  # ---------------------------------------------------------------------------
  # Disposable email domain blocklist
  # ---------------------------------------------------------------------------

  # Common disposable / throwaway email providers. This list covers the most
  # widely-used services — it is not exhaustive but blocks the vast majority
  # of throwaway signups without any external API call.
  @disposable_domains ~w(
    mailinator.com guerrillamail.com guerrillamail.net guerrillamail.org
    guerrillamail.biz guerrillamail.de guerrillamail.info
    temp-mail.org temp-mail.io tempmail.com tempmail.net tempmail.de
    throwam.com throwam.net trashmail.com trashmail.at trashmail.io
    trashmail.me trashmail.net yopmail.com yopmail.fr yopmail.pp.ua
    sharklasers.com guerrillamailblock.com grr.la guerrillamail.info
    spam4.me spamgourmet.com spamgourmet.net spamgourmet.org
    maildrop.cc mailnull.com mailnull.net mailnesia.com
    getairmail.com airmail.com dispostable.com disposablemail.com
    fakeinbox.com fakeinbox.net fakemail.net fakemail.fr
    mailnew.com mailnew.de 10minutemail.com 10minutemail.net
    10minutemail.org 10minutemail.de 10minutemail.co.uk 10minemail.com
    10mail.org 20minutemail.com 30minutemail.com 60minutemail.com
    minutemail.com minuteinbox.com mytemp.email mytempemail.com
    tempr.email tempomail.fr temporary-mail.net temporaryemail.net
    temporaryemail.com temporaryinbox.com throwaway.email
    throwamailbox.com throwamailbox.net easytrashmail.com
    getnada.com nada.email moakt.com mohmal.com zetmail.com
    spamhereplease.com spaml.de spaml.com spamspot.com
    spamevader.com spamoff.de s0ny.net anonbox.net anonmails.de
    binkmail.com bobmail.info chogmail.com cool.fr.nf
    courriel.fr.nf courrieltemporaire.com discard.email discardmail.com
    discardmail.de dodgit.com dudmail.com e4ward.com
    emailias.com emailinfive.com emailsensei.com emailtemporario.com.br
    emltmp.com enterto.com ephemail.net etranquil.com
    example.com ezfill.com filzmail.com filzmail.de
    filzmail.org fivemail.de fleckens.hu frapmail.com
    garliclife.com get2mail.fr getonemail.net greensloth.com
    hatespam.org herp.in hidemail.pro hidzz.com
    hmamail.com hopemail.biz inoutmail.de inoutmail.net
    inoutmail.eu instantemailaddress.com jetable.com jetable.fr.nf
    jetable.net jetable.org junk1.tk kasmail.com klassmaster.com
    klzlk.com kurzepost.de lol.ovpn.to lookugly.com
    lortemail.dk m4ilweb.info mail.by mail4trash.com
    mailbidon.com mailboxy.fun mailcatch.com mailexpire.com
    mailfreeonline.com mailfs.com mailguard.me mailimate.com
    mailme.lv mailme24.com mailmetrash.com mailmoat.com
    mailnow.de mailquack.com mailrock.biz mailscrap.com
    mailseal.de mailshell.com mailshiv.com mailslapping.com
    mailslite.com mailss.com mailsucker.net mailtome.de
    mailtothis.com mailzilla.org mbx.cc mega.zik.dj meltmail.com
    mierdamail.com mintemail.com misterpinball.de mobi.web.id
    mobileninja.co.uk moncourrier.fr.nf monemail.fr.nf
    monmail.fr.nf mt2009.com mx0.wwwnew.eu mycard.net.ua
    mydemo.pro myfake.net myfakeinbox.com mymail-in.net
    myphantomemail.com mysamp.de netzidiot.de neverbox.com
    noblepioneer.com noicd.com nospam.ze.tc nospamfor.us
    nospamthanks.info notmailinator.com nowmymail.com objectmail.com
    obobbo.com odnorazovoe.ru one-time.email oneoffemail.com
    oneoffmail.com onewaymail.com online.ms onqin.com
    opayq.com ordinaryamerican.net otherinbox.com owlpic.com
    pjjkp.com plexolan.de poczta.onet.pl politikerclub.de
    polyfaust.com poofy.org pookmail.com postacı.net
    powered.name privacy.net privy-mail.com proxymail.eu
    punkass.com putthisinyourspamdatabase.com qq.com
    qsl.at quickinbox.com rcpt.at re-gister.com
    recode.me recursor.net recyclemail.dk regbypass.com
    rklips.com rmqkr.net royal.net rppkn.com
    rtrtr.com s0ny.net safe-mail.net safersignup.de
    safetymail.info safetypost.de sandelf.de saynotospams.com
    selfdestructingmail.com sendspamhere.com sharklasers.com
    sharedmailbox.org shitaway.cu shitmail.de shitmail.me
    shitmail.org shitmail.us shiyakila.cf showslow.de
    sibmail.com skeefmail.com slippery.email slopsbox.com
    slowslow.de slushmail.com smellfear.com snakemail.com
    sneakemail.com sneakmail.de snkmail.com sofimail.com
    sogetthis.com sotraps.com spamavert.com spambob.com
    spambob.net spambob.org spamcon.org spamcorptastic.com
    spamcowboy.com spamcowboy.net spamcowboy.org spamday.com
    spamdecoy.net spamex.com spamfree24.de spamfree24.org
    spamgaps.net spamhole.com spamify.com spaminmotion.com
    spamkill.info spaml.com spaml.de spammotel.com spammy.host
    spamnot.com spamoff.de spamossa.com spamotron.com
    spampoison.com spampost.com spamsalad.in spamslicer.com
    spamstack.net spamthis.co.uk spamthisplease.com spamtrail.com
    spamtrap.ro spamwc.com spamwc.de speed.1s.fr
    spr.io ssoia.com startkeys.com stinkefinger.net
    stop-my-spam.com streetwisemail.com stuffmail.de suburbanthug.com
    supergreatmail.com supermailer.jp suremail.info svk.jp
    sweetxxx.de tafmail.com tagyourself.com tefl.ro
    tempalias.com tempemails.net tempinbox.co.uk tempinbox.com
    tempsky.com tempthe.net temptmail.com thankyou2010.com
    thisisnotmyrealemail.com throwam.com throwam.net throwmail.org
    tilien.com tittbit.in tizi.com tmailinator.com
    toiea.com top9.eu topranklist.de tradermail.info
    trash-amil.com trash-mail.at trash-mail.com trash-mail.de
    trash-mail.ga trash-mail.io trash2009.com trashmail.at
    trashmail.com trashmail.de trashmail.io trashmail.me
    trashmail.net trashmail.xyz trashmailer.com trashmails.com
    trillianpro.com trmd.com tryalert.com turual.com
    twinmail.de twoweeksmail.com tyldd.com ubm.md
    uggsrock.com uroid.com usgprogram.com venompen.com
    veryrealemail.com viditag.com viralplays.com vixletdev.com
    vmailing.info vomoto.com votiputox.org vubby.com
    wazabi.club webm4il.info wetrainbayarea.com whatiaas.com
    whyspam.me willhackforfood.biz willselfdestruct.com wmail.cf
    wolke7.net wuzup.net wuzupmail.net www.e4ward.com
    wwwnew.eu xagloo.co xagloo.com xemaps.com xents.com
    xmaily.com xoxy.net xyzmail.fr yapped.net yapped.net
    yeah.net yesey.net yogamaven.com yopmail.com
    yopmail.fr yoru-dea.com youmail.ga yourdomain.com
    ypmail.webarnak.fr.eu.org yuurok.com z1p.biz za.com
    zebins.com zebins.eu zehnminutenmail.de zippymail.info
    zoemail.net zoemail.org zomg.inf zomail.org zippymail.info
  )

  defp disposable_email?(nil), do: false
  defp disposable_email?(""),  do: false
  defp disposable_email?(email) do
    case String.split(String.downcase(email), "@") do
      [_local, domain] -> domain in @disposable_domains
      _                -> false
    end
  end

  # ---------------------------------------------------------------------------
  # Username heuristics
  # ---------------------------------------------------------------------------

  # Patterns that strongly suggest bot-generated usernames:
  #   - Contains a URL (http/https/www or .com/.net/.org/.io)
  #   - Ends in 4+ consecutive digits (e.g. user849271, john1234)
  #   - Is 20+ chars of pure alphanumeric with no vowels (keyboard mash)
  #   - Contains common spammer suffixes
  @username_url_re       ~r/https?:\/\/|www\.|\.com|\.net|\.org|\.io/i
  @username_digits_re    ~r/\d{4,}$/
  @username_no_vowels_re ~r/^[^aeiouAEIOU]{15,}$/

  defp suspicious_username?(nil),  do: false
  defp suspicious_username?(""),   do: false
  defp suspicious_username?(username) do
    Regex.match?(@username_url_re, username) or
    Regex.match?(@username_digits_re, username) or
    Regex.match?(@username_no_vowels_re, username)
  end

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
