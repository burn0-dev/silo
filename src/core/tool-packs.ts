/**
 * Optional tool packs offered during `silo init`.
 *
 * The selection is recorded in the environment manifest. Nothing binds a pack
 * to the runtime yet — that arrives with the tool-pack system.
 */

export type ToolPack = {
  id: string;
  label: string;
};

export const TOOL_PACKS: ToolPack[] = [
  { id: "calendar", label: "Calendar" },
  { id: "email", label: "Email" },
  { id: "crm", label: "CRM" },
  { id: "browser", label: "Browser" },
  { id: "files", label: "Files" },
];
