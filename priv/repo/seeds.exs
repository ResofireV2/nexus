alias Nexus.Repo
alias Nexus.Forum.{Space, Tag}

unless Repo.aggregate(Space, :count) > 0 do
  IO.puts("Seeding spaces...")

  spaces = [
    %{name: "General", slug: "general", description: "General discussion", color: "#4A9EFF", position: 1}
  ]

  for attrs <- spaces do
    %Space{}
    |> Space.changeset(attrs)
    |> Repo.insert!(on_conflict: :nothing)
  end

  IO.puts("Seeding tags...")

  tags = [
    %{name: "general", color: "#4A9EFF"}
  ]

  for attrs <- tags do
    %Tag{}
    |> Tag.changeset(attrs)
    |> Repo.insert!(on_conflict: :nothing)
  end

  IO.puts("Done seeding.")
end

alias Nexus.Pages
alias Nexus.Pages.Page
alias Nexus.Pages.PageWidget

unless Repo.aggregate(Page, :count) > 0 do
  IO.puts("Seeding default pages...")

  # Create the default "Legal & Info" widget. on_conflict: :nothing means if it
  # already exists the insert is silently skipped and the returned struct has id: nil.
  # In that case we fetch the existing row by name.
  {:ok, inserted_widget} =
    %PageWidget{}
    |> PageWidget.changeset(%{name: "Legal & Info", position: 0})
    |> Repo.insert(on_conflict: :nothing)

  legal_widget =
    if inserted_widget.id,
      do:   inserted_widget,
      else: Repo.get_by!(PageWidget, name: "Legal & Info")

  privacy_body = ~S"""
# Privacy Policy

**Last updated:** [Date]

This Privacy Policy describes how [Forum Name] ("we", "us", or "our"), operated by [Operator Name], collects, uses, and protects your personal data when you use this forum (the "Service"). We are committed to full transparency about our data practices.

Please read this policy carefully. By registering for or using the Service, you confirm that you are at least 16 years of age and agree to the practices described in this policy.

---

## 1. Who We Are

[Forum Name] is a self-hosted community forum operated by:

**[Operator Name]**
[Address, if applicable]
[Contact email address]

For any questions about this policy or your personal data, contact us at: **[Contact email address]**

---

## 2. Data We Collect

### 2.1 Account information
When you register, we collect:
- **Email address** — used for login, email verification, notifications, and digest emails
- **Username** — your public display name
- **Password** — stored as a one-way bcrypt hash; we cannot retrieve your original password

If you register via OAuth (Google or GitHub), we receive your email address and a provider-specific user ID from that service. We do not receive or store your OAuth password.

### 2.2 Profile information (optional)
You may optionally provide:
- Avatar image and cover image
- Biography text
- Social links

This information is publicly visible to other members of the forum.

### 2.3 Content you post
We store:
- Posts (threads) and replies you author, including their full text
- Reactions you give to others' content
- Direct messages you send (visible only to thread participants)
- Drafts you save

### 2.4 Technical data
We automatically collect:
- **IP address and browser user agent** at each login — stored in login event logs, retained for **90 days**, then automatically deleted
- **IP address** at registration — used for spam prevention (see Section 4), stored in blocked registration records for up to **1 year**

### 2.5 Browser storage
We store the following data in your browser's `localStorage` to make the application function:
- Authentication token (JWT) — required for login sessions
- Cached user profile — to avoid re-fetching on every page load
- Theme and appearance preferences — to remember your display settings
- Forum branding cache — to avoid redundant network requests

None of this data is used for advertising or tracking. It is functional data that lives only in your browser and is cleared when you log out.

### 2.6 Cookies
We set one cookie: `_nexus_refresh` — an HttpOnly, SameSite=Strict cookie that stores a hashed refresh token used to keep you logged in. This cookie is strictly necessary for the Service to function. No tracking or advertising cookies are set.

### 2.7 Push notification subscriptions
If you opt in to web push notifications, we store your browser's push subscription endpoint and encryption keys. This data is used solely to deliver notifications from this forum to your browser. It is deleted when you unsubscribe or delete your account.

---

## 3. Legal Basis for Processing (GDPR)

If you are located in the European Economic Area (EEA), we process your personal data under the following legal bases:

| Data | Legal basis |
|---|---|
| Account data (email, username, password hash) | Contract — necessary to provide the Service |
| Content you post | Contract — necessary to provide the Service |
| Login events (IP address, user agent) | Legitimate interest — security and fraud prevention |
| Registration IP address | Legitimate interest — spam and abuse prevention |
| Browser storage and cookies | Legitimate interest / strictly necessary |
| Push notification subscriptions | Consent — you explicitly opt in |
| Profile information (bio, avatar, links) | Consent — you choose to provide this |

---

## 4. Third-Party Data Sharing

We do not sell, rent, or share your personal data with third parties for advertising or commercial purposes. We share data with the following service only for the purpose of protecting the forum from spam:

**StopForumSpam (stopforumspam.org)** — at registration time, your IP address, username, and an MD5 hash of your email address are sent to the StopForumSpam API. This is a widely-used anti-spam service. Your raw email address is never sent — only a one-way hash. If StopForumSpam is unreachable, registration proceeds normally. StopForumSpam's own privacy policy is available at [https://www.stopforumspam.com/legal](https://www.stopforumspam.com/legal).

We also fetch Open Graph metadata (page title, description, image) from URLs posted in threads in order to generate link previews. This is a server-side request — no personal data is sent to the linked site.

We do not use Google Analytics, Meta Pixel, or any other third-party analytics or advertising technology. **This forum does not serve advertisements.**

---

## 5. Data Retention

| Data type | Retention period |
|---|---|
| Account data | Until you delete your account |
| Posts and replies | Until you delete your account (anonymised or deleted — see Section 7) |
| Direct messages you sent | Deleted when your account is deleted |
| Login event logs (IP, user agent) | 90 days, then automatically deleted |
| Registration IP records | 1 year, then automatically deleted |
| Push notification subscriptions | Until you unsubscribe or delete your account |

---

## 6. Data Security

Your password is stored as a bcrypt hash — it is computationally infeasible to reverse. Refresh tokens are stored as SHA-256 hashes and are never stored in retrievable form. All data is transmitted over HTTPS. Authentication tokens are short-lived JWTs.

We take reasonable technical and organisational measures to protect your data. However, no internet service can guarantee absolute security.

---

## 7. Your Rights (GDPR)

If you are located in the EEA, you have the following rights regarding your personal data:

**Right of access** — you can download a copy of all data we hold about you at any time from **Settings → Security → Download your data**. The export is provided as a ZIP archive containing your profile, posts, replies, messages, and badges.

**Right to erasure ("right to be forgotten")** — you can permanently delete your account from **Settings → Security → Delete account**. Deletion is subject to a 30-day grace period during which you can cancel. After 30 days your account is permanently purged. Depending on the forum's configuration, your posts and replies will either be anonymised (attributed to "Deleted User") or permanently deleted.

**Right to rectification** — you can update your profile information, email address, and username from your account settings at any time.

**Right to restriction** — you may contact us to request that we restrict processing of your data in certain circumstances.

**Right to object** — you may object to processing based on legitimate interests by contacting us at **[Contact email address]**.

**Right to data portability** — your data export (see Right of access above) is provided in standard JSON and CSV formats, which are machine-readable and portable.

**Right to withdraw consent** — where processing is based on consent (push notifications, optional profile data), you can withdraw consent at any time from your account settings.

To exercise any right not available through your account settings, contact us at **[Contact email address]**. We will respond within 30 days.

You also have the right to lodge a complaint with your national data protection authority. In the EU, you can find your authority at [https://edpb.europa.eu/about-edpb/about-edpb/members_en](https://edpb.europa.eu/about-edpb/about-edpb/members_en).

---

## 8. Age Restriction

This Service is not intended for anyone under the age of 16. By registering, you confirm that you are at least 16 years of age. If we become aware that a user under 16 has registered, we will delete their account and associated data promptly. If you believe a minor has registered, please contact us at **[Contact email address]**.

---

## 9. Cookies Summary

| Cookie | Purpose | Type | Expiry |
|---|---|---|---|
| `_nexus_refresh` | Keeps you logged in between sessions | Strictly necessary | Session or 30 days (if "remember me" is selected) |

No other cookies are set. We do not use tracking, analytics, or advertising cookies.

---

## 10. Changes to This Policy

We may update this policy from time to time. When we do, we will update the "Last updated" date at the top of this page. Significant changes will be announced on the forum. Continued use of the Service after changes are posted constitutes your acceptance of the updated policy.

---

## 11. Contact

For any questions, requests, or concerns regarding this Privacy Policy or your personal data:

**[Operator Name]**
**[Contact email address]**
[Address, if applicable]

---

*This forum runs on [Nexus](https://github.com/ResofireV2/nexus), open-source self-hosted forum software.*
"""

  tos_body = ~S"""
# Terms of Service

**Last updated:** [Date]

Please read these Terms of Service ("Terms") carefully before using [Forum Name] (the "Service"), operated by [Operator Name] ("we", "us", or "our"). By registering for or using the Service, you agree to be bound by these Terms. If you do not agree, do not use the Service.

---

## 1. Eligibility

You must be at least **16 years of age** to use this Service. By registering, you represent and warrant that you are 16 or older. If we discover that a user is under 16, we will terminate their account and delete their data promptly.

---

## 2. Your Account

**Registration.** You must provide accurate and complete information when creating an account. You are responsible for keeping your account credentials secure. Do not share your password with anyone.

**One account per person.** You may not create multiple accounts. Duplicate accounts may be removed without notice.

**Account responsibility.** You are responsible for all activity that occurs under your account. If you believe your account has been compromised, contact us immediately at **[Contact email address]**.

**Account termination.** We reserve the right to suspend or terminate your account at any time if you violate these Terms, without prior notice or liability.

---

## 3. Acceptable Use

You agree to use the Service only for lawful purposes and in a way that does not infringe the rights of others or restrict or inhibit their use of the Service.

**You must not:**

- Post content that is unlawful, harmful, threatening, abusive, harassing, defamatory, obscene, or otherwise objectionable
- Post content that infringes any third party's intellectual property, privacy, or other rights
- Impersonate any person or entity, or misrepresent your affiliation with any person or entity
- Post spam, unsolicited advertising, or repetitive content designed to disrupt discussion
- Attempt to gain unauthorised access to the Service, its servers, or any systems connected to the Service
- Upload malware, viruses, or any other malicious code
- Engage in coordinated harassment, brigading, or targeted abuse of other members
- Scrape, harvest, or collect user data from the Service without our express written permission
- Use the Service for any commercial purpose without our prior written consent

---

## 4. Content

**Your content.** You retain ownership of content you post to the Service. By posting content, you grant us a non-exclusive, royalty-free, worldwide licence to store, display, and distribute that content as necessary to provide the Service.

**Content standards.** All content must comply with Section 3. We reserve the right — but are not obligated — to review, edit, or remove any content at our discretion.

**Content you see.** Content posted by other members does not represent our views or values. We are not responsible for content posted by users.

**Reporting.** If you see content that you believe violates these Terms, please use the report feature or contact us at **[Contact email address]**.

---

## 5. Intellectual Property

The Service itself — including its design, code, and branding — is owned by us or our licensors. You may not copy, reproduce, or create derivative works from any part of the Service without our express written permission.

Content you post remains yours. We do not claim ownership of it beyond the licence described in Section 4.

---

## 6. Privacy

Your use of the Service is also governed by our [Privacy Policy](/p/privacy), which is incorporated into these Terms by reference. By using the Service, you agree to our collection and use of data as described in the Privacy Policy.

---

## 7. Moderation

We reserve the right to moderate the Service at our sole discretion. This includes removing content, issuing warnings, muting users, or banning accounts that violate these Terms or that we determine are harmful to the community.

Moderation decisions are final. While we aim to be fair and consistent, we are not obligated to provide detailed explanations for moderation actions.

---

## 8. Availability

We aim to keep the Service available at all times but cannot guarantee uninterrupted access. The Service may be unavailable due to maintenance, technical issues, or circumstances beyond our control. We reserve the right to modify, suspend, or discontinue the Service at any time without notice or liability.

---

## 9. Disclaimer of Warranties

The Service is provided **"as is"** and **"as available"** without warranties of any kind, either express or implied, including but not limited to warranties of merchantability, fitness for a particular purpose, or non-infringement. We do not warrant that the Service will be error-free, secure, or uninterrupted.

---

## 10. Limitation of Liability

To the fullest extent permitted by applicable law, we shall not be liable for any indirect, incidental, special, consequential, or punitive damages arising from your use of or inability to use the Service, even if we have been advised of the possibility of such damages.

Our total liability to you for any claim arising from these Terms or the Service shall not exceed the amount you paid us in the twelve months preceding the claim (or, if you have paid nothing, zero).

---

## 11. Indemnification

You agree to indemnify and hold harmless [Operator Name] and its affiliates, officers, and agents from any claims, liabilities, damages, and expenses (including reasonable legal fees) arising from your use of the Service, your content, or your violation of these Terms.

---

## 12. Links to Third-Party Sites

The Service may contain links to external websites. We are not responsible for the content or privacy practices of those sites. Links do not imply endorsement.

---

## 13. Changes to These Terms

We may update these Terms from time to time. When we do, we will update the "Last updated" date at the top of this page. Significant changes will be announced on the forum. Your continued use of the Service after changes are posted constitutes your acceptance of the updated Terms.

---

## 14. Governing Law

These Terms are governed by the laws of **[Your jurisdiction — e.g. England and Wales / State of California / etc.]**, without regard to conflict of law principles. Any disputes arising from these Terms shall be subject to the exclusive jurisdiction of the courts of **[Your jurisdiction]**.

---

## 15. Severability

If any provision of these Terms is found to be unenforceable or invalid, that provision shall be limited or eliminated to the minimum extent necessary, and the remaining provisions shall remain in full force and effect.

---

## 16. Entire Agreement

These Terms, together with our Privacy Policy, constitute the entire agreement between you and us regarding the Service and supersede all prior agreements and understandings.

---

## 17. Contact

If you have any questions about these Terms, contact us at:

**[Operator Name]**
**[Contact email address]**
[Address, if applicable]

---

*This forum runs on [Nexus](https://github.com/ResofireV2/nexus), open-source self-hosted forum software.*
"""

  guidelines_body = ~S"""
# Community Guidelines

Welcome to **[Forum Name]**. We're glad you're here.

This is a place built around genuine conversation — sharing ideas, asking questions, helping each other out, and building something worth being part of. These guidelines exist not to restrict you, but to make sure this stays a place everyone actually wants to spend time in.

We ask that you read through them and keep them in mind whenever you post. They aren't exhaustive — good judgment and basic kindness go a long way.

---

## 1. Treat people the way you'd want to be treated

This is the foundation everything else is built on. Behind every username is a real person. Disagree with ideas, not people. Critique constructively, not cruelly.

**This means:**
- No personal insults, name-calling, or targeted mockery of other members
- No harassment — including following someone across threads to antagonise them
- No threats of any kind, serious or "joking"
- No deliberately provoking or baiting other members into conflict

If someone is getting under your skin, step away. Come back later. The thread will still be there.

---

## 2. No hate speech or discrimination

There is no place here for content that dehumanises, demeans, or attacks people based on who they are.

This includes but is not limited to content targeting people based on:
- Race, ethnicity, or national origin
- Religion or lack thereof
- Gender or gender identity
- Sexual orientation
- Disability or health condition
- Age or socioeconomic status

This applies to slurs, "jokes", memes, and dog-whistles just as much as direct statements. Intent doesn't override impact.

---

## 3. Keep it clean — language and NSFW content

This is a community that includes members of varying ages, backgrounds, and preferences. Keep that in mind.

- **Language** — the occasional strong word isn't the end of the world, but sustained profanity or using crude language to demean others is not welcome
- **NSFW content** — explicit sexual content, graphic violence, or otherwise adult material is not permitted anywhere on the forum
- **Shock content** — do not post content designed purely to disturb, disgust, or upset other members

When in doubt, ask yourself: would you be comfortable if someone you respect saw you post this?

---

## 4. Political and sensitive topics

Politics and other divisive topics can generate meaningful discussion — they can also tear communities apart if handled poorly. We don't ban these subjects outright, but we ask that you approach them with particular care.

- Present your views without attacking those who hold different ones
- Do not post political content designed purely to provoke or inflame
- Do not use the forum to campaign, recruit, or spread propaganda for any political cause or movement
- Extremist content of any kind — content that promotes, glorifies, or incites violence or hatred — will be removed immediately and may result in a permanent ban

If a political conversation is generating more heat than light, moderators may lock or remove it.

---

## 5. Be honest

Trust is the currency of any community. Don't abuse it.

- Do not impersonate other members, public figures, or staff
- Do not misrepresent yourself, your credentials, or your intentions
- Do not spread deliberate misinformation or hoaxes
- Do not create multiple accounts to evade a ban, inflate votes, or manipulate discussions

---

## 6. Respect others' privacy

- Do not share another person's personal information without their consent — this includes real names, addresses, phone numbers, emails, or any other identifying information ("doxxing")
- Do not share private conversations or direct messages publicly without the consent of all parties involved
- Be thoughtful about what you share about yourself too — this is a public forum

---

## 7. Keep self-promotion in check

Sharing your work, your project, or something you're proud of is fine and welcome. Turning the forum into a personal advertising channel is not.

- Do not post the same link or promotion repeatedly across multiple threads or spaces
- Do not create threads whose sole purpose is to drive traffic elsewhere
- If you're affiliated with something you're recommending, say so — transparency is appreciated

---

## 8. Post in the right place

A well-organised forum is a more useful forum. Help us keep it that way.

- Post in the space that best fits your topic
- Before posting a question, check whether it's already been answered
- Keep threads on-topic — if a conversation naturally shifts to a new subject, consider starting a new thread
- Do not bump old threads unnecessarily

---

## 9. What happens if you break the rules

We try to handle things proportionately. Depending on the severity:

- A friendly reminder or warning
- Post removal
- Temporary mute or suspension
- Permanent ban

Serious violations — hate speech, harassment, threats, doxxing, spam — may result in an immediate permanent ban without prior warning.

If you believe a moderation decision was made in error, contact us at **[Contact email address]**. We're human and we make mistakes.

---

## 10. Report, don't retaliate

If you see something that violates these guidelines, use the report button — don't engage, argue, or retaliate. Retaliating often makes things worse and can result in action being taken against you as well.

Reports are reviewed by moderators. We appreciate everyone who helps keep this community in good shape.

---

## 11. Moderators and staff

Our moderators are volunteers and members of this community. Treat them with the same respect you'd extend to anyone else. Arguing with, insulting, or attempting to manipulate moderators will not change a decision and may make things worse.

Moderator decisions made in good faith are final. Appeals can be directed to **[Contact email address]**.

---

## A final word

Rules can only take you so far. What makes a community genuinely good is the people in it deciding to show up with good intentions, patience, and a willingness to give others the benefit of the doubt.

We're building something here. We're glad you want to be a part of it.

— The **[Forum Name]** team

---

*Questions or concerns? Reach us at **[Contact email address]**.*
"""

  pages = [
    %{
      slug:      "privacy",
      title:     "Privacy Policy",
      body:      privacy_body,
      published: false,
      widget_id: legal_widget.id
    },
    %{
      slug:      "terms",
      title:     "Terms of Service",
      body:      tos_body,
      published: false,
      widget_id: legal_widget.id
    },
    %{
      slug:      "guidelines",
      title:     "Community Guidelines",
      body:      guidelines_body,
      published: false,
      widget_id: legal_widget.id
    }
  ]

  for attrs <- pages do
    %Page{}
    |> Page.changeset(attrs)
    |> Repo.insert!(on_conflict: :nothing)
  end

  IO.puts("Done seeding pages.")
end
