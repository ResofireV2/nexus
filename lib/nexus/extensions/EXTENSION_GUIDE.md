# Nexus Extension Development Guide

## Quick Start

```bash
# Inside your Nexus project directory
mix nexus.extension.new my-extension --author "Your Name" --description "Does something cool"
cd extensions/my-extension
```

## Extension Structure

```
my-extension/
├── manifest.json          # Extension metadata
├── mix.exs                # Elixir project file
├── README.md
└── lib/
    ├── my_extension.ex    # Main module (implements Nexus.Extensions.Behaviour)
    └── my_extension/
        └── hooks.ex       # Hook handlers
```

## Available Hook Events

| Event             | Payload                        | Fired when...                  |
|-------------------|--------------------------------|--------------------------------|
| `post_created`    | `%{post_id: id}`               | A post is published            |
| `post_updated`    | `%{post_id: id}`               | A post is edited               |
| `post_deleted`    | `%{post_id: id}`               | A post is deleted              |
| `reply_created`   | `%{reply_id: id, post_id: id}` | A reply is posted              |
| `user_registered` | `%{user_id: id}`               | A new user registers           |
| `user_login`      | `%{user_id: id}`               | A user logs in                 |
| `reaction_added`  | `%{emoji: e, user_id: id}`     | A reaction is added            |
| `report_created`  | `%{report_id: id}`             | Content is reported            |

## Available UI Slots

| Slot              | Location                        |
|-------------------|---------------------------------|
| `feed_top`        | Above the post feed             |
| `feed_bottom`     | Below the post feed             |
| `feed_sidebar`    | Feed sidebar                    |
| `post_header`     | Above post content              |
| `post_footer`     | Below post content              |
| `post_sidebar`    | Post page sidebar               |
| `reply_footer`    | Below each reply                |
| `profile_header`  | Above user profile              |
| `profile_sidebar` | User profile sidebar            |
| `nav_top`         | Top of navigation               |
| `nav_bottom`      | Bottom of navigation            |
| `admin_sidebar`   | Admin panel sidebar             |

## Installing Your Extension

```bash
# Get your admin token by logging in via the API
TOKEN=$(curl -s -X POST http://localhost:4000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@example.com","password":"yourpassword"}' \
  | jq -r '.access_token')

# Install the extension
curl -X POST http://localhost:4000/api/v1/admin/extensions \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d @manifest.json
```

## Settings Schema

Extensions can declare configurable settings:

```elixir
def settings_schema do
  %{
    "webhook_url" => %{
      type: "string",
      label: "Webhook URL",
      required: true,
      placeholder: "https://..."
    },
    "notify_on_post" => %{
      type: "boolean",
      label: "Notify on new posts",
      default: true
    }
  }
end
```

Settings are configured by admins in the Nexus admin panel and passed
to your hook handlers via the `extension.settings` map.
