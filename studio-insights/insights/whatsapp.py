"""WhatsApp push via Meta's WhatsApp Cloud API.

Needs env vars WHATSAPP_TOKEN and WHATSAPP_PHONE_NUMBER_ID (from Meta Business).
Meta only allows free-form text if the recipient messaged the business number in the
last 24 hours. For reliable daily pushes use mode=template with an approved template
whose body has one variable, e.g. "דוח יומי:\n{{1}}". Template variables cannot hold
newlines, so in template mode lines are joined with " | ".
"""
from __future__ import annotations

import os

import requests

from .config import Config

GRAPH_URL = "https://graph.facebook.com/v21.0/{phone_id}/messages"
MAX_TEXT = 4000
MAX_TEMPLATE_PARAM = 1000


def _chunks(text: str, size: int) -> list[str]:
    parts, cur = [], ""
    for line in text.splitlines():
        if len(cur) + len(line) + 1 > size and cur:
            parts.append(cur)
            cur = ""
        cur += line + "\n"
    if cur.strip():
        parts.append(cur)
    return parts


def build_payloads(text: str, to: str, cfg: Config) -> list[dict]:
    wa = cfg.raw.get("whatsapp", {})
    if wa.get("mode", "text") == "template":
        # template variables may not contain newlines -> one flattened line per chunk
        return [{
            "messaging_product": "whatsapp", "to": to, "type": "template",
            "template": {"name": wa.get("template_name", "studio_report"),
                         "language": {"code": wa.get("template_lang", "he")},
                         "components": [{"type": "body", "parameters": [
                             {"type": "text", "text": " | ".join(l.strip() for l in part.splitlines() if l.strip())}]}]},
        } for part in _chunks(text, MAX_TEMPLATE_PARAM)]
    return [{"messaging_product": "whatsapp", "to": to, "type": "text",
             "text": {"preview_url": False, "body": part}} for part in _chunks(text, MAX_TEXT)]


def send(text: str, cfg: Config, dry_run: bool = False) -> list[dict]:
    recipients = cfg.raw.get("whatsapp", {}).get("recipients", [])
    payloads = [p for to in recipients for p in build_payloads(text, str(to), cfg)]
    if dry_run:
        return payloads
    token = os.environ.get("WHATSAPP_TOKEN")
    phone_id = os.environ.get("WHATSAPP_PHONE_NUMBER_ID")
    if not token or not phone_id:
        raise RuntimeError("Set WHATSAPP_TOKEN and WHATSAPP_PHONE_NUMBER_ID to send WhatsApp messages")
    results = []
    for p in payloads:
        r = requests.post(GRAPH_URL.format(phone_id=phone_id), json=p,
                          headers={"Authorization": f"Bearer {token}"}, timeout=30)
        r.raise_for_status()
        results.append(r.json())
    return results
