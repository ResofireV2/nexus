defmodule NexusWeb.Router do
  use NexusWeb, :router

  pipeline :browser do
    plug :accepts, ["html"]
    plug :fetch_session
    plug :fetch_live_flash
    plug :put_root_layout, html: {NexusWeb.Layouts, :root}
    plug :protect_from_forgery
    plug :put_secure_browser_headers
    plug NexusWeb.Plugs.PwaSettings
    plug NexusWeb.Plugs.ExtensionBundles
  end

  pipeline :api do
    plug :accepts, ["json"]
    plug :fetch_cookies
    plug NexusWeb.Plugs.LoadUser
  end

  pipeline :extension_api do
    plug :fetch_cookies
    plug NexusWeb.Plugs.LoadUser
  end

  pipeline :authenticated do
    plug NexusWeb.Plugs.RequireAuth
    plug NexusWeb.Plugs.ActivityTracker
  end

  pipeline :admin do
    plug NexusWeb.Plugs.RequireAuth
    plug NexusWeb.Plugs.RequireAdmin
  end

  pipeline :moderator do
    plug NexusWeb.Plugs.RequireAuth
    plug NexusWeb.Plugs.RequireModerator
  end

  # Public browser routes
  scope "/", NexusWeb do
    pipe_through :browser
    get "/", PageController, :home
  end

  # PWA manifest — explicit path, pipe through :api for JSON response
  scope "/manifest.json", NexusWeb.API.V1 do
    pipe_through :api
    get "/", PwaController, :manifest
  end

  # Setup wizard (public - runs before any auth exists)
  scope "/api/v1/setup", NexusWeb.API.V1 do
    pipe_through :api
    get  "/status",  SetupController, :status
    post "/step/1",  SetupController, :step_one
    post "/step/2",  SetupController, :step_two
    post "/step/3",  SetupController, :step_three
  end

  # API v1 — auth (public)
  scope "/api/v1/auth", NexusWeb.API.V1 do
    pipe_through :api
    post "/register",     AuthController, :register
    post "/login",        AuthController, :login
    post "/logout",       AuthController, :logout
    post "/refresh",      AuthController, :refresh
    post "/magic-link",   AuthController, :magic_link_request
    get  "/magic",        AuthController, :magic_link_verify
    get  "/verify-email", AuthController, :verify_email
    get  "/oauth/google",          AuthController, :oauth_google
    get  "/oauth/google/callback", AuthController, :oauth_google_callback
    get  "/oauth/github",          AuthController, :oauth_github
    get  "/oauth/github/callback", AuthController, :oauth_github_callback
  end

  # API v1 — auth (authenticated)
  scope "/api/v1/auth", NexusWeb.API.V1 do
    pipe_through [:api, :authenticated]
    get   "/me",                 AuthController, :me
    patch "/me",                 AuthController, :update_me
    post  "/resend-verification", AuthController, :resend_verification
  end

  # API v1 — public read
  scope "/api/v1", NexusWeb.API.V1 do
    pipe_through :api
    get "/spaces",                 SpaceController,  :index
    get "/spaces/:slug",           SpaceController,  :show
    get "/tags",                   TagController,    :index
    get "/feed",                   FeedController,   :index
    get "/posts/:id",              PostController,   :show
    get "/posts/:id/reactions",    ReactionController, :show_post_reactions
    get    "/posts/:id/edits",                      PostController,     :edits
    get    "/posts/:post_id/replies/:id/edits",     ReplyController,    :edits
    post   "/posts/:id/accept/:reply_id",           PostController,     :accept_answer
    delete "/posts/:id/accept",                     PostController,     :unaccept_answer
    get "/replies/:id/reactions",  ReactionController, :show_reply_reactions
    get "/posts/:post_id/replies", ReplyController,  :index
    get "/search",                 SearchController, :index
    get "/stats",                  FeedController,   :stats
    get "/users",                  AdminController,  :list_users_public
    get "/users/:username",        AdminController,      :get_user_public
    get "/users/:username/badges", BadgeController,      :user_badges
    get "/users/:username/replies",    UserContentController, :replies
    get "/users/:username/reactions",  UserContentController, :reactions
    get "/users/:username/mentions",   UserContentController, :mentions
    get "/branding",               AdminController,  :get_branding
    get "/badges/recent",           BadgeController,  :recent_earners
    get "/badges",                 BadgeController,  :index
    get "/leaderboard/streaks",    LeaderboardController, :streaks
    get "/leaderboard",            LeaderboardController, :index
    get "/slots/all",              ExtensionController,  :slots_all
    get "/pwa/vapid-public-key",   PwaController,        :vapid_public_key
  end

  # API v1 — authenticated member actions
  scope "/api/v1", NexusWeb.API.V1 do
    pipe_through [:api, :authenticated]

    # Leaderboard — own rank
    get "/leaderboard/me", LeaderboardController, :me

    # File uploads
    post "/uploads", UploadController, :create

    # Subscriptions
    post   "/spaces/:slug/subscribe", SpaceController, :subscribe
    delete "/spaces/:slug/subscribe", SpaceController, :unsubscribe
    post   "/tags/:slug/subscribe",   TagController,   :subscribe
    delete "/tags/:slug/subscribe",   TagController,   :unsubscribe

    # Posts
    post   "/posts",     PostController, :create
    patch  "/posts/:id", PostController, :update
    delete "/posts/:id", PostController, :delete

    # Replies
    post   "/posts/:post_id/replies",     ReplyController, :create
    patch  "/posts/:post_id/replies/:id", ReplyController, :update
    delete "/posts/:post_id/replies/:id", ReplyController, :delete

    # Reactions
    post   "/reactions", ReactionController, :create
    delete "/reactions", ReactionController, :delete

    # Reports
    post "/reports", ReportController, :create

    # Direct messaging
    get    "/threads",                           ThreadController, :index
    get    "/threads/unread",                    ThreadController, :unread
    post   "/threads/direct",                   ThreadController, :create_direct
    post   "/threads/group",                    ThreadController, :create_group
    get    "/threads/:id",                      ThreadController, :show
    patch  "/threads/:id",                      ThreadController, :update
    delete "/threads/:id",                      ThreadController, :delete
    post   "/threads/:id/mute",                 ThreadController, :mute
    post   "/threads/:id/read",                 ThreadController, :mark_read
    post   "/threads/:id/members",              ThreadController, :add_member
    delete "/threads/:id/members/:user_id",     ThreadController, :remove_member

    get  "/threads/:thread_id/messages", MessageController, :index
    post "/threads/:thread_id/messages", MessageController, :create

    # Push subscriptions
    post   "/push/subscribe",            PushController, :subscribe
    delete "/push/subscribe",            PushController, :unsubscribe
    get    "/push/subscriptions",        PushController, :list_subscriptions
    delete "/push/subscriptions/:id",    PushController, :revoke_subscription

    # Notifications
    get  "/notifications",          NotificationController, :index
    get  "/notifications/unread",   NotificationController, :unread
    post "/notifications/read-all", NotificationController, :mark_all_read
    patch "/notifications/:id/read", NotificationController, :mark_read
    delete "/notifications/:id",    NotificationController, :delete
    delete "/notifications",        NotificationController, :delete_all

    # Badges (authenticated)
    get "/badges/my", BadgeController, :my_badges

    # User profile media (auth required — access enforced in controller)
    get "/users/:username/uploads", UserContentController, :uploads

    # Saved items (bookmarks)
    get    "/saved",                               SaveController, :index
    post   "/posts/:id/save",                      SaveController, :save_post
    delete "/posts/:id/save",                      SaveController, :unsave_post
    post   "/posts/:post_id/replies/:id/save",     SaveController, :save_reply
    delete "/posts/:post_id/replies/:id/save",     SaveController, :unsave_reply
  end

  # API v1 — moderator actions
  scope "/api/v1", NexusWeb.API.V1 do
    pipe_through [:api, :moderator]

    # Tags
    post   "/tags",        TagController, :create
    patch  "/tags/:slug",  TagController, :update
    delete "/tags/:slug",  TagController, :delete

    # Post moderation
    get    "/posts/:id/follow",  PostFollowController, :show
    post   "/posts/:id/follow",  PostFollowController, :create
    delete "/posts/:id/follow",  PostFollowController, :delete
    post "/posts/:id/pin",  PostController, :pin
    post "/posts/:id/lock", PostController, :lock
    post "/posts/:id/hide",          PostController, :hide
    get  "/posts/:id/read-position",  PostController, :read_position
    post "/posts/:id/read-position",  PostController, :save_read_position

    # Reply moderation
    post "/posts/:post_id/replies/:id/hide", ReplyController, :hide

    # Reports
    get   "/reports",     ReportController,     :index
    patch "/reports/:id", ReportController,     :update

    # User moderation
    post   "/moderation/users/:username/ban",     ModerationController, :ban
    delete "/moderation/users/:username/ban",     ModerationController, :unban
    post   "/moderation/users/:username/mute",    ModerationController, :mute
    delete "/moderation/users/:username/mute",    ModerationController, :unmute
    post   "/moderation/users/:username/suspend", ModerationController, :suspend
    delete "/moderation/users/:username/suspend", ModerationController, :unsuspend

    # Moderation log
    get "/moderation/log", ModerationController, :log
  end

  # API v1 — admin actions
  scope "/api/v1/admin", NexusWeb.API.V1 do
    pipe_through [:api, :admin]

    get    "/dashboard",          AdminController,  :dashboard
    get    "/system",             AdminController,  :system
    get    "/queues",             AdminController,  :queues
    get    "/logs/settings",      AdminController,  :setting_changes
    get    "/logs/jobs",          AdminController,  :job_failures
    get    "/users",              AdminController,  :list_users
    get    "/users/:id",          AdminController,  :get_user
    patch  "/users/:id/role",     AdminController,  :update_role
    patch  "/users/:id/verify-email", AdminController, :verify_email
    delete "/users/:id",          AdminController,  :delete_user
    post   "/users/:id/mark-spammer", AdminController, :mark_spammer

    # Anti-spam
    get    "/blocked-registrations", AdminController, :blocked_registrations

    get    "/settings",           AdminController,  :get_settings
    patch  "/settings/:key",      AdminController,  :update_settings
    post   "/test-email",         AdminController,  :test_email

    # Pending approval queue
    get    "/pending",                        AdminController, :pending
    post   "/pending/:type/:id/approve",      AdminController, :approve_pending
    delete "/pending/:type/:id",              AdminController, :reject_pending

    # Uploads management
    get    "/uploads",            UploadController, :index
    get    "/uploads/stats",      UploadController, :stats
    delete "/uploads/:id",        UploadController, :delete

    # Spaces (admin only)
    post   "/spaces",             SpaceController, :create
    patch  "/spaces/:slug",       SpaceController, :update
    delete "/spaces/:slug",       SpaceController, :delete

    # Extensions
    get    "/extensions",                    ExtensionController, :index
    get    "/extensions/store",              ExtensionController, :store
    get    "/extensions/:slug",              ExtensionController, :show
    post   "/extensions",                    ExtensionController, :install
    post   "/extensions/install-from-url",   ExtensionController, :install_from_url
    post   "/extensions/:slug/toggle",       ExtensionController, :toggle
    post   "/extensions/:slug/sync",         ExtensionController, :sync_manifest
    post   "/extensions/:slug/update",       ExtensionController, :update_extension
    post   "/extensions/check-updates",      ExtensionController, :check_updates
    patch  "/extensions/:slug/settings",     ExtensionController, :update_settings
    delete "/extensions/:slug",              ExtensionController, :uninstall

    # Badges (admin)
    get    "/badges",                  BadgeController, :admin_index
    post   "/badges",                  BadgeController, :create
    post   "/badges/install-presets",  BadgeController, :install_presets
    post   "/badges/backfill",         BadgeController, :backfill
    patch  "/badges/:id",              BadgeController, :update
    delete "/badges/:id",              BadgeController, :delete
    post   "/badges/:id/award",        BadgeController, :award
    delete "/badges/:id/revoke/:user_id", BadgeController, :revoke
    get    "/badges/:id/holders",      BadgeController, :holders

    # Leaderboard (admin)
    get    "/leaderboard/settings",    LeaderboardController, :get_settings
    patch  "/leaderboard/settings",    LeaderboardController, :update_settings
    post   "/leaderboard/recalculate", LeaderboardController, :recalculate

    # Digest (admin)
    get    "/digest/settings",         DigestController, :get_settings
    patch  "/digest/settings",         DigestController, :update_settings
    post   "/digest/test",             DigestController, :send_test

    # PWA (admin)
    post   "/pwa/vapid",               PwaController,    :generate_vapid
    post   "/pwa/icons",               PwaController,    :upload_icons
    delete "/pwa/icons",               PwaController,    :delete_icons
    post   "/pwa/badge",               PwaController,    :upload_badge
    delete "/pwa/badge",               PwaController,    :delete_badge
    get    "/push-subscriptions",      AdminController,  :push_subscriptions

    # Updates
    get    "/updates/check",           AdminController,  :check_update
    post   "/updates/apply",           AdminController,  :apply_update
  end

  # Public slot endpoint
  scope "/api/v1", NexusWeb.API.V1 do
    pipe_through :api
    get "/slots/:slot", ExtensionController, :slots

    # Extension bundle URLs — served from the extension's static assets directory.
    # No proxy, no separate service — assets live inside the Nexus uploads directory.
    get "/extensions/:slug/assets/*path", ExtensionController, :serve_asset
  end

  # Extension static assets — served without pipeline restrictions so script tags
  # and image requests (which send Accept: */*, not application/json) work correctly.
  scope "/ext" do
    get "/:slug/assets/*path", NexusWeb.ExtensionRouter, :serve_asset_action
  end

  # Extension API routes — XHR/fetch calls from extension JS bundles.
  # Uses extension_api pipeline which loads user context but doesn't restrict
  # Accept header — extensions may receive various content types.
  scope "/ext" do
    pipe_through :extension_api
    get    "/:slug/*path",   NexusWeb.ExtensionRouter, :api_action
    post   "/:slug/*path",   NexusWeb.ExtensionRouter, :api_action
    put    "/:slug/*path",   NexusWeb.ExtensionRouter, :api_action
    patch  "/:slug/*path",   NexusWeb.ExtensionRouter, :api_action
    delete "/:slug/*path",   NexusWeb.ExtensionRouter, :api_action
  end

  if Application.compile_env(:nexus, :dev_routes) do
    scope "/dev" do
      pipe_through :browser
      forward "/mailbox", Plug.Swoosh.MailboxPreview
    end
  end

  # Extension SPA routes — /ext/* is the dedicated prefix for all extension pages.
  # Because this is an explicit server-side scope, hard refreshes on any /ext/* path
  # are always served the HTML shell by Nexus, then React boots and the extension
  # bundle resolves the route client-side. No Caddy changes needed for any extension.
  scope "/ext", NexusWeb do
    pipe_through :browser
    get "/*path", PageController, :home
  end

  # SPA catch-all — must be last so API routes take priority
  scope "/", NexusWeb do
    pipe_through :browser
    get "/*path", PageController, :home
  end
end
