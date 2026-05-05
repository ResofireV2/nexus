alias Nexus.Repo
alias Nexus.Forum.{Space, Tag}

unless Repo.aggregate(Space, :count) > 0 do
  IO.puts("Seeding spaces...")

  spaces = [
    %{name: "General", slug: "general", description: "General discussion", color: "#4A9EFF", position: 1},
    %{name: "Development", slug: "development", description: "Development and engineering", color: "#B060DF", position: 2},
    %{name: "Help", slug: "help", description: "Ask for help", color: "#9B59B6", position: 3},
    %{name: "Showcase", slug: "showcase", description: "Show off your work", color: "#2ECC71", position: 4},
    %{name: "Meta", slug: "meta", description: "About this forum", color: "#E67E22", position: 5}
  ]

  for attrs <- spaces do
    %Space{}
    |> Space.changeset(attrs)
    |> Repo.insert!(on_conflict: :nothing)
  end

  IO.puts("Seeding tags...")

  tags = [
    %{name: "announcement", color: "#E85552"},
    %{name: "question", color: "#4A9EFF"},
    %{name: "tutorial", color: "#2ECC71"},
    %{name: "discussion", color: "#B060DF"},
    %{name: "feedback", color: "#E67E22"},
    %{name: "bug", color: "#E74C3C"},
    %{name: "feature", color: "#3498DB"}
  ]

  for attrs <- tags do
    %Tag{}
    |> Tag.changeset(attrs)
    |> Repo.insert!(on_conflict: :nothing)
  end

  IO.puts("Done seeding.")
end
