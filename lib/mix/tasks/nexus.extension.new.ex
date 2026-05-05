defmodule Mix.Tasks.Nexus.Extension.New do
  use Mix.Task

  @shortdoc "Scaffold a new Nexus extension"

  @moduledoc """
  Generates a new Nexus extension scaffold.

  ## Usage

      mix nexus.extension.new my_extension
      mix nexus.extension.new my_extension --author "Your Name" --description "Does something cool"

  ## Options

    * `--author` - Extension author name
    * `--description` - Short description of the extension
    * `--dir` - Output directory (default: ./extensions/<name>)
  """

  @switches [author: :string, description: :string, dir: :string]

  def run(args) do
    {opts, argv, _} = OptionParser.parse(args, switches: @switches)

    name =
      case argv do
        [name | _] -> name
        [] ->
          Mix.raise("Extension name is required. Usage: mix nexus.extension.new <name>")
      end

    slug        = name |> String.downcase() |> String.replace(~r/[^a-z0-9]/, "-")
    module_name = name |> Macro.camelize()
    author      = Keyword.get(opts, :author, "Unknown")
    description = Keyword.get(opts, :description, "A Nexus extension")
    dir         = Keyword.get(opts, :dir, "extensions/#{slug}")

    Mix.shell().info("Creating extension #{module_name} in #{dir}/")
    File.mkdir_p!(dir)

    # mix.exs
    write_file("#{dir}/mix.exs", mix_exs_template(module_name, slug, opts))

    # Main extension module
    File.mkdir_p!("#{dir}/lib")
    write_file("#{dir}/lib/#{slug}.ex", extension_module_template(module_name, slug, description, author))

    # Hooks module
    write_file("#{dir}/lib/#{slug}/hooks.ex", hooks_template(module_name, slug))

    # README
    write_file("#{dir}/README.md", readme_template(module_name, slug, description))

    # manifest.json
    write_file("#{dir}/manifest.json", manifest_template(module_name, slug, description, author))

    Mix.shell().info("""

    Extension #{module_name} created successfully!

    Next steps:
      1. cd #{dir}
      2. Edit lib/#{slug}.ex to configure your hooks and slots
      3. Implement your hook handlers in lib/#{slug}/hooks.ex
      4. Install into your Nexus instance:
           mix nexus.extension.install ./#{dir}
    """)
  end

  defp write_file(path, content) do
    File.write!(path, content)
    Mix.shell().info("  created #{path}")
  end

  defp mix_exs_template(module_name, slug, opts) do
    version = Keyword.get(opts, :version, "0.1.0")
    """
    defmodule #{module_name}.MixProject do
      use Mix.Project

      def project do
        [
          app: :#{String.replace(slug, "-", "_")},
          version: "#{version}",
          elixir: "~> 1.17",
          start_permanent: Mix.env() == :prod,
          deps: deps()
        ]
      end

      def application do
        [extra_applications: [:logger]]
      end

      defp deps do
        []
      end
    end
    """
  end

  defp extension_module_template(module_name, slug, description, author) do
    """
    defmodule #{module_name} do
      @behaviour Nexus.Extensions.Behaviour

      @impl true
      def manifest do
        %{
          name: "#{module_name}",
          slug: "#{slug}",
          version: "0.1.0",
          description: "#{description}",
          author: "#{author}",
          hooks: [
            # Uncomment to subscribe to events:
            # %{event: "post_created", handler: "#{module_name}.Hooks", priority: 50},
            # %{event: "user_registered", handler: "#{module_name}.Hooks", priority: 50}
          ],
          slots: [
            # Uncomment to inject into UI slots:
            # %{slot: "feed_sidebar", component: "#{slug}/sidebar", priority: 50}
          ]
        }
      end

      @impl true
      def handle(event, payload, extension) do
        #{module_name}.Hooks.handle(event, payload, extension)
      end

      @impl true
      def settings_schema do
        %{
          # "api_key" => %{type: "string", label: "API Key", required: true}
        }
      end
    end
    """
  end

  defp hooks_template(module_name, _slug) do
    """
    defmodule #{module_name}.Hooks do
      require Logger

      def handle("post_created", %{post_id: post_id}, _extension) do
        Logger.info("#{module_name}: post created - \#{post_id}")
        :ok
      end

      def handle(event, _payload, _extension) do
        Logger.debug("#{module_name}: unhandled event \#{event}")
        :ok
      end
    end
    """
  end

  defp readme_template(module_name, slug, description) do
    """
    # #{module_name}

    #{description}

    ## Installation

    Add to your Nexus instance:

    ```bash
    mix nexus.extension.install ./path/to/#{slug}
    ```

    ## Configuration

    Configure via the Nexus admin panel at `/admin/extensions/#{slug}`.

    ## Development

    ```bash
    mix deps.get
    mix test
    ```
    """
  end

  defp manifest_template(module_name, slug, description, author) do
    Jason.encode!(%{
      name: module_name,
      slug: slug,
      version: "0.1.0",
      description: description,
      author: author,
      nexus_version: ">= 0.1.0"
    }, pretty: true)
  end
end
