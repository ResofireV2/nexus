defmodule Nexus.Drafts do
  import Ecto.Query
  alias Nexus.Repo
  alias Nexus.Drafts.Draft

  @max_drafts_per_user 50

  # ── List ─────────────────────────────────────────────────────────────────────

  def list_drafts(user_id) do
    Repo.all(
      from d in Draft,
      where: d.user_id == ^user_id,
      left_join: s in Nexus.Forum.Space, on: d.space_id == s.id,
      left_join: p in Nexus.Forum.Post,  on: d.post_id  == p.id,
      order_by: [desc: d.updated_at],
      select: %{
        id:         d.id,
        type:       d.type,
        title:      d.title,
        body:       d.body,
        post_type:  d.post_type,
        space_id:   d.space_id,
        post_id:    d.post_id,
        tag_ids:    d.tag_ids,
        updated_at: d.updated_at,
        inserted_at: d.inserted_at,
        space_name:  s.name,
        space_slug:  s.slug,
        space_color: s.color,
        post_title:  p.title,
      }
    )
  end

  def count_drafts(user_id) do
    Repo.one(from d in Draft, where: d.user_id == ^user_id, select: count(d.id)) || 0
  end

  # ── Get ──────────────────────────────────────────────────────────────────────

  def get_draft(id, user_id) do
    Repo.get_by(Draft, id: id, user_id: user_id)
  end

  # ── Create ───────────────────────────────────────────────────────────────────

  def create_draft(user_id, attrs) do
    if count_drafts(user_id) >= @max_drafts_per_user do
      {:error, :limit_reached}
    else
      %Draft{}
      |> Draft.changeset(Map.put(attrs, "user_id", user_id))
      |> Repo.insert()
    end
  end

  # ── Update ───────────────────────────────────────────────────────────────────

  def update_draft(%Draft{} = draft, attrs) do
    draft
    |> Draft.changeset(attrs)
    |> Repo.update()
  end

  # ── Delete ───────────────────────────────────────────────────────────────────

  def delete_draft(%Draft{} = draft) do
    Repo.delete(draft)
  end

  def delete_all_drafts(user_id) do
    Repo.delete_all(from d in Draft, where: d.user_id == ^user_id)
  end
end
