// services/widget-design.service.ts — the owner-editable look of the website chat bubble.
// Stored inside sites.settings.widgetDesign; read defensively because settings is free-form JSON.

export interface ChatDesign {
  title: string;
  subtitle: string;
  greeting: string;
  color: string;
  position: "right" | "left";
  launcher: "icon" | "label";
  launcherLabel: string;
  fontFamily: "system" | "inherit";
  radius: "rounded" | "square";
  customCss: string;
}

export const DEFAULT_CHAT_DESIGN: ChatDesign = {
  title: "Chat with us",
  subtitle: "We usually reply in a few minutes",
  greeting: "Hi! What's your name and phone or email so we can help?",
  color: "#0b5d4b",
  position: "right",
  launcher: "icon",
  launcherLabel: "Chat with us",
  fontFamily: "system",
  radius: "rounded",
  customCss: "",
};

import { sanitizeCss } from "../utils/css";

const HEX = /^#[0-9a-fA-F]{6}$/;

const text = (v: unknown, fallback: string, max: number) =>
  typeof v === "string" && v.trim() ? v.trim().slice(0, max) : fallback;

export function readChatDesign(raw: unknown): ChatDesign {
  const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return {
    title: text(r.title, DEFAULT_CHAT_DESIGN.title, 40),
    subtitle: text(r.subtitle, DEFAULT_CHAT_DESIGN.subtitle, 80),
    greeting: text(r.greeting, DEFAULT_CHAT_DESIGN.greeting, 300),
    color: typeof r.color === "string" && HEX.test(r.color) ? r.color : DEFAULT_CHAT_DESIGN.color,
    position: r.position === "left" ? "left" : "right",
    launcher: r.launcher === "label" ? "label" : "icon",
    launcherLabel: text(r.launcherLabel, DEFAULT_CHAT_DESIGN.launcherLabel, 24),
    fontFamily: r.fontFamily === "inherit" ? "inherit" : "system",
    radius: r.radius === "square" ? "square" : "rounded",
    customCss: sanitizeCss(r.customCss),
  };
}
