# DCITM CRM V2: Hierarchical Audience Groups — Implementation Specification

**Version:** 1.0 · **Date:** 26 October 2026 · **Status:** Approved for implementation
**Scope:** The Groups section of DCITM CRM V2 and the audience step of the campaign builder.

This document and the design canvas ("DCITM Audience Groups") together define the feature. If they disagree, the business rules in this document take priority. All numbers in the design are sample data.

---

## 1. Goal

Replace the current flat Groups page (contact-list cards) with a three-level hierarchy:

**Industry → Subcategory → Audience Group → Contacts**

The team must be able to organize leads by industry and niche, then target either a whole industry or a single niche in a campaign. Duplicate and unsubscribed contacts must be removed before sending.

## 2. Design references

| Artboard | What it shows |
|---|---|
| Groups dashboard: category explorer | Main Groups page: header, stats, category tree, details panel, groups table, drag in progress |
| Campaign selector: entire industry | Audience step with a whole industry selected |
| Campaign selector: specific niche | Audience step with one subcategory selected |
| Review: recipient validation and schedule lock | Final recipient count and scheduling |
| Empty, search, delete, move and reorder states | Supporting states and dialogs |
| Migration check: existing lists | One-time organization of the current lists |

Keep the existing CRM V2 visual style shown in the design: dark charcoal backgrounds, thin borders, white primary text, muted grey secondary text, uppercase small labels, white primary buttons, and outlined secondary buttons. Do not restyle the rest of the CRM.

## 3. Terms

- **Category:** an organizing node. It never contains contacts directly. There are two kinds:
  - **Industry:** top level (for example, Restaurants).
  - **Subcategory:** second level, always inside one industry (for example, BBQ Restaurants).
- **Audience group:** the existing contact list entity. It holds contact memberships and is what campaigns actually send to.
- **Unassigned lists:** a virtual bucket for groups that have no parent subcategory.
- **System list:** a list maintained by the system (for example, Subscribers). It is locked and is never placed in a category.
- **Records:** the total number of group memberships (one contact in two groups is two records).
- **Unique eligible recipients:** unique email addresses after duplicates and unsubscribed contacts are removed.

## 4. Data model (conceptual)

Use the existing tables where they exist. Add only what the rules below need.

**Category**
- id, name (required), description (optional)
- parent_id: empty for an industry; the industry's id for a subcategory
- level: 1 (industry) or 2 (subcategory). Derived from parent_id, never above 2
- sort_order (position among siblings)
- created_at, updated_at, updated_by

**Audience group** (existing list entity, extended)
- Add parent_category_id: empty (Unassigned) or the id of a **subcategory**. It must never point to an industry.
- Add sort_order (position within its subcategory).
- Existing id, name, description, type, and contact memberships are **unchanged**.

**Campaign audience**
- Targets: a set of category ids and/or audience group ids.
- Before scheduling, targets are resolved dynamically (Section 8).
- When scheduled, the resolved final recipient list is stored as a **recipient snapshot** belonging to that campaign (Section 9).

## 5. Hierarchy rules

1. Exactly three levels: Industry → Subcategory → Audience group. No deeper nesting.
2. An industry contains only subcategories. A subcategory contains only audience groups.
3. Each audience group has **one** primary parent subcategory, or none (Unassigned lists). Groups cannot belong to several categories.
4. Groups cannot be placed directly under an industry.
5. Category counts are aggregates of their descendant groups:
   - Industry: number of groups and records in all its subcategories.
   - Subcategory: number of groups and records in its own groups.
6. Moving or reorganizing categories or groups **never** changes contact membership. Only the parent link and sort order change.
7. System lists stay outside the hierarchy and cannot be moved, deleted, or renamed from the Groups page.

## 6. Groups page

### 6.1 Header
- Label "Audience Registry", title "Audience Groups", and a short subtitle.
- Global search for industries, subcategories, groups and contacts (Ctrl+K opens it).
- Actions: **+ New Category** (primary), **New Group**, **Import CSV**.

### 6.2 Summary statistics
| Tile | Value |
|---|---|
| Total Categories | industries + subcategories (caption: "X industries · Y subcategories") |
| Audience Groups | all groups (caption: categorized vs unassigned) |
| Total Contacts | total records across all groups |
| Unique Reachable | unique email addresses after removing duplicates and unsubscribed contacts |

### 6.3 Category explorer (left panel)
- A tree with expand/collapse chevrons, indentation, and guide lines. Toolbar actions: new industry, expand all, collapse all.
- A filter field narrows the tree by category or group name.
- Each row shows: icon, name, group count, and contact count. Groups show only their contact count.
- Categories use a folder icon. Groups use the boxed people icon. They must look clearly different.
- Groups appear as leaf rows under an expanded subcategory.
- An "Unassigned lists" row sits at the bottom of the tree.
- Clicking a row selects it and opens it in the details panel. The selected row has a lifted background and outline.

### 6.4 Details panel (right panel), for a selected category
- A breadcrumb (All Categories / Industry / Subcategory). Each part links to that level.
- Name, "CATEGORY" tag, description, and last-updated info.
- Actions: **Edit**, **Move**, **Delete**. Add **+ Subcategory** only when an industry is selected. Never offer it on a subcategory.
- Meta strip: parent category, level, number of groups (and subcategories for an industry), total contacts with unique count.
- **Industry selected:** list its subcategories with their counts.
- **Subcategory selected:**
  - A structure strip showing Industry → Subcategory → Audience groups.
  - A "Target this category in a campaign" bar with the unique count and a "Use in campaign" button that opens the campaign builder with this category preselected.
  - The audience groups table: checkbox, Group Name (with source/type), Parent Category, Contacts, Last Updated, Actions (View, more menu), and **+ Create Audience Group**.
  - A footer line: groups, records, unique contacts, and how many contacts appear in more than one group.

### 6.5 Empty state
A new category with no groups shows: "No audience groups yet", **Create Audience Group**, **Import CSV into [category]**, and **Add subcategory** (industry only).

### 6.6 Search results
- Results are grouped by Categories, Audience Groups and Contacts, with the matching text highlighted.
- Filter chips: All, Categories, Groups, Contacts.
- Each group and contact result shows its full path (for example, "Restaurants / BBQ Restaurants").
- "Show in tree" expands the tree to that item and selects it.
- Keyboard: arrow keys move, Enter opens, Tab shows in tree, Esc closes.

## 7. Create, edit, move, delete

### 7.1 Create
- **New Category** creates an industry, or a subcategory when an industry is chosen as parent.
- **New Group / Create Audience Group** creates a group. Its parent must be a subcategory, or it can be left Unassigned.
- **Import CSV** follows the existing import flow and adds a parent subcategory choice.

### 7.2 Delete a category
- Deleting a category **never** deletes groups or contacts.
- Require the user to type the category name to confirm.
- **Deleting an industry:** the user chooses one option:
  1. Move its subcategories (with their groups) to another industry, or
  2. Delete its subcategories as well, and move all their groups to Unassigned lists.
- **Deleting a subcategory:** its groups move to another subcategory or to Unassigned lists.
- The dialog lists the impact:
  - Scheduled campaigns are **not changed**; they keep their locked lists.
  - Unscheduled (draft) campaigns that target this category are listed and will need a new audience.

### 7.3 Move (dialog or drag-and-drop)
Follow the drag-and-drop rules in Section 7.4. The Move button opens the same confirmation as a cross-parent drag.

### 7.4 Drag-and-drop
**Allowed drops:**
| Dragged item | Allowed target |
|---|---|
| Industry | reorder among industries only |
| Subcategory | reorder within its industry, or move to another industry |
| Audience group | reorder within its subcategory, or move to another subcategory or to Unassigned lists |

**Blocked drops** show a "Drop not allowed" message and do nothing:
- A subcategory into another subcategory (would create a fourth level).
- A group directly into an industry.
- Anything into a group.

**Behavior:**
1. **Reorder within the same parent:** apply immediately with no confirmation. Show an "Undo" toast.
2. **Move to a different parent:** show a confirmation dialog containing:
   - From path and To path.
   - A statement that this is an organization change only and the group keeps all its contacts.
   - If any **scheduled** campaign targets the source or destination category: a warning that the campaign is protected and keeps its locked recipient list.
   - Cancel and Move buttons. Offer Undo after the move.
3. **Visual feedback while dragging:**
   - The source row is dimmed with a dashed outline.
   - A floating chip shows the item name and count.
   - The valid target row is highlighted with a dashed accent outline.
   - A tooltip states whether a confirmation will follow.

## 8. Campaign audience selection

The audience step in the campaign builder uses the same tree, with checkboxes.

1. **Selecting an industry** includes all its subcategories and groups (whole-industry targeting).
2. **Selecting a subcategory** includes only that subcategory's groups (niche targeting). Sibling subcategories are not included.
3. Individual groups, including Unassigned lists, can also be selected.
4. **Checkbox states:**
   - Selected.
   - **Included via parent:** greyed and locked, labelled "via [parent]".
   - **Partly selected:** the parent shows a dash, with text such as "1 of 8 subcategories".
5. **Preventing duplicate targeting:** an item already included through a parent cannot be selected again. It shows "Already included via [parent]". Selecting a parent replaces any separate child selections under it.
6. **Selection summary:**
   - Chips for each selection.
   - A "Review N groups" link.
   - Records, duplicates removed, unsubscribed removed, and **"Estimated today"** (unique eligible count).
7. **Dynamic audience:** a visible "Dynamic" note states that contacts and groups added to the selected categories are included automatically until the campaign is scheduled. A category target stores the category, not a fixed group list.
8. Footer text: "The final unique count is validated in Review before sending."

## 9. Recipient validation, sending and scheduling

### 9.1 Validation (required before any send or schedule)
When the Review step opens, and when the user clicks **Revalidate**, the system must:
1. Resolve all targets to their current groups and contacts (dynamic resolution).
2. Remove duplicate email addresses, so each address appears once. Compare addresses trimmed and case-insensitive.
3. Exclude all unsubscribed contacts.
4. Calculate and display, in this order:
   - Records in the selected groups.
   - Duplicate email addresses removed.
   - Unsubscribed contacts excluded.
   - **Final unique, eligible recipients** (shown prominently).
5. Show the time of the last validation. If contacts or groups changed since the audience was chosen, show a notice describing the change.
6. Provide "View excluded" and "Download recipient list (CSV)".
7. The send or schedule button must state the final count (for example, "Schedule for 444 recipients").

### 9.2 Send now
Run validation immediately before sending and send only to the validated final list.

### 9.3 Schedule
1. On scheduling, run validation and **store the final recipient list as the campaign's snapshot.**
2. After scheduling, the snapshot **must not change** because of:
   - groups moving between categories,
   - categories being renamed, moved or deleted,
   - contacts being added to or removed from groups.
3. The CRM must never silently change a scheduled campaign's audience.
4. The Review screen states: "Scheduling locks these N recipients. Later changes to groups or categories will not change this campaign."

## 10. Migration of existing lists

Run once, when the feature is released, through the "Organize existing lists" screen.

1. Show all existing lists with type, contact count, proposed place, and a check result.
2. Default placements, based on the current lists:
   - **Subscribers** (system list) → System lists, locked.
   - **Group for warmup** → kept outside categories, so the Warm-up Engine keeps using it unchanged.
   - **Test group** and **Default Leads** → Unassigned lists until someone assigns a parent subcategory.
3. Migration only adds a parent link. Group IDs, contact memberships and existing campaign references must not change.
4. Show and verify: contacts enrolled before = contacts enrolled after (63 = 63 in the current data), and campaign audiences changed = 0.
5. Nothing changes until **Apply organization** is clicked.

**Before release:** run the migration against a copy of the production database. Confirm that every list and every contact membership is unchanged, and that no scheduled campaign's recipients changed.

## 11. Acceptance criteria

- [ ] A fourth level cannot be created through any route: create, move, drag, import or API.
- [ ] A group can never have more than one parent, and can never be placed under an industry.
- [ ] Moving or deleting categories never adds, removes or copies contacts.
- [ ] Selecting an industry targets all its descendant groups. Selecting a subcategory targets only its own groups.
- [ ] A group already included through a parent cannot be added again in the same campaign.
- [ ] The final count excludes duplicate email addresses and unsubscribed contacts, and matches the actual send list.
- [ ] Contacts added to a targeted category before scheduling appear in the final count.
- [ ] A scheduled campaign's recipient list stays identical after groups or categories are moved, renamed or deleted, or after contacts are added to those groups.
- [ ] Reordering within the same parent needs no confirmation and can be undone. Cross-parent moves always ask for confirmation.
- [ ] Scheduled campaigns are reported as protected in move and delete dialogs.
- [ ] After migration, total memberships and campaign audiences are unchanged.

## 12. Open points to confirm with the product owner

These were proposed in the design but **not yet confirmed**. Do not finalize them without approval.

1. **Unsubscribes after scheduling:** the design removes contacts who unsubscribe between scheduling and the send time, even though the list is otherwise locked. This is recommended for anti-spam compliance.
2. **Warm-up list:** the design keeps "Group for warmup" out of category targeting so warm-up addresses never receive marketing campaigns.

## 13. Out of scope

- No changes to other CRM sections beyond the campaign audience and review steps.
- No change to how contacts are stored or how CSV import parses files.
- Permissions follow the CRM's existing role rules (Team & RBAC). This specification adds no new roles.
