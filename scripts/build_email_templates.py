#!/usr/bin/env python3
"""
Build the branded Supabase auth email templates (and the logo they use).

Supabase wants ONE self-contained HTML blob per template, pasted into the
dashboard — six near-identical files that would drift the moment anyone edited
the footer of five of them. So the shell lives here once and the six are
generated from it. Re-run after any change and paste whichever ones moved.

Why the markup looks like 1999: mail clients are not browsers. Outlook renders
through Word (no flexbox, no background-image, no CSS variables), Gmail strips
much of <style>, and every client disagrees about margins. Tables with inline
styles and `bgcolor` attributes are what survives all of them. The colours are
literal hex on purpose and mirror src/styles/tokens.css — the same exception the
MapLibre paint files get, for the same reason: the consumer cannot read a CSS
variable. Keep them in step with the tokens by hand.

Usage:
    python scripts/build_email_templates.py
    python scripts/build_email_templates.py --origin https://app.tntpollination.com

Outputs:
    supabase/email-templates/*.html   paste into Supabase -> Auth -> Emails
    public/email/logo.png             the mark, sized and matted for mail
"""
from __future__ import annotations

import argparse
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "supabase" / "email-templates"
LOGO_SRC = ROOT / "public" / "bee-dark.png"       # the honey mark, for dark grounds
LOGO_OUT = ROOT / "public" / "email" / "logo.png"

DEFAULT_ORIGIN = "https://tntoperations.netlify.app"
SUPPORT_EMAIL = "tyler.torrie@tntpollination.com"  # mirrors src/config/contact.ts

# -- Colour, straight off the design tokens ----------------------------------
INK_950 = "#050506"   # page
INK_850 = "#111114"   # card
INK_700 = "#202027"   # hairline (solid: rgba borders are unreliable in mail)
INK_600 = "#2C2C34"
INK_300 = "#7C7C8A"   # muted text
INK_100 = "#CFCFD6"   # secondary text
INK_50 = "#ECECEF"    # primary text
HONEY = "#FEB836"     # --brand
FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif"
MONO = "ui-monospace,SFMono-Regular,Menlo,Consolas,monospace"

CONFIRM_URL = "{{ .ConfirmationURL }}"


def shell(*, title: str, preheader: str, heading: str, body: str, origin: str) -> str:
    """The frame every mail shares. `body` is the middle of the card."""
    return f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark light">
<meta name="supported-color-schemes" content="dark light">
<title>{title}</title>
<style>
  /* Progressive enhancement only - every rule that matters is also inline. */
  @media (max-width:620px) {{
    .wrap {{ width:100% !important; }}
    .pad {{ padding:24px !important; }}
  }}
</style>
</head>
<body style="margin:0;padding:0;background:{INK_950};">
<!-- Inbox preview line; never rendered in the body. -->
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;height:0;width:0;">{preheader}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="{INK_950}" style="background:{INK_950};">
  <tr>
    <td align="center" style="padding:32px 12px;">
      <table role="presentation" class="wrap" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:600px;">

        <!-- Masthead -->
        <tr>
          <td align="left" style="padding:0 0 20px 0;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td style="padding-right:12px;" valign="middle">
                  <img src="{origin}/email/logo.png" width="44" height="44" alt=""
                       style="display:block;width:44px;height:44px;border:0;border-radius:8px;">
                </td>
                <td valign="middle" style="font-family:{FONT};font-size:13px;font-weight:700;
                    letter-spacing:.14em;text-transform:uppercase;color:{INK_50};">
                  TNT&nbsp;Pollination
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- Card -->
        <tr>
          <td class="pad" bgcolor="{INK_850}" style="background:{INK_850};border:1px solid {INK_700};
              border-radius:12px;padding:36px;">
            <h1 style="margin:0 0 14px 0;font-family:{FONT};font-size:22px;line-height:1.3;
                font-weight:700;color:{INK_50};">{heading}</h1>
{body}
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="padding:22px 4px 0 4px;font-family:{FONT};font-size:12px;line-height:1.6;color:{INK_300};">
            TNT Pollination - leafcutter bee pollination.<br>
            Questions: <a href="mailto:{SUPPORT_EMAIL}" style="color:{INK_100};text-decoration:underline;">{SUPPORT_EMAIL}</a>
          </td>
        </tr>

      </table>
    </td>
  </tr>
</table>
</body>
</html>
"""


def para(text: str, *, muted: bool = False, top: int = 0) -> str:
    colour = INK_300 if muted else INK_100
    size = "13px" if muted else "15px"
    return (f'            <p style="margin:{top}px 0 0 0;font-family:{FONT};font-size:{size};'
            f'line-height:1.65;color:{colour};">{text}</p>')


def button(label: str) -> str:
    """A table-cell button: the one shape Outlook renders as a real button."""
    return f"""            <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:26px 0 0 0;">
              <tr>
                <td bgcolor="{HONEY}" style="background:{HONEY};border-radius:8px;">
                  <a href="{CONFIRM_URL}"
                     style="display:inline-block;padding:13px 26px;font-family:{FONT};font-size:15px;
                            font-weight:700;color:{INK_950};text-decoration:none;border-radius:8px;">{label}</a>
                </td>
              </tr>
            </table>"""


def fallback() -> str:
    """Some clients strip the button; some people paste links into a browser."""
    return f"""            <p style="margin:26px 0 0 0;padding:14px;background:{INK_950};border:1px solid {INK_700};
                border-radius:8px;font-family:{MONO};font-size:12px;line-height:1.5;
                color:{INK_300};word-break:break-all;">
              Or paste this into your browser:<br>
              <span style="color:{INK_100};">{CONFIRM_URL}</span>
            </p>"""


def ignore(what: str) -> str:
    return para(f"If you weren&rsquo;t expecting this, ignore it &mdash; {what}", muted=True, top=22)


# -- The six mails ------------------------------------------------------------
def templates(origin: str) -> dict[str, str]:
    return {
        # Sent by netlify/functions/invite-user.mjs on a first invite.
        "invite.html": shell(
            origin=origin,
            title="You've been added to TNT Operations",
            preheader="Set your password and sign in to TNT Operations.",
            heading="You&rsquo;ve been added to TNT Operations",
            body="\n".join([
                para("TNT Operations is where we plan shelter placement, track incubation and record field "
                     "work. Your account is ready &mdash; this link sets your password and signs you in."),
                button("Set your password"),
                fallback(),
                para("The link can be used once and expires in 24 hours. If it has already expired, ask an "
                     "administrator to send another from Users &amp; Settings.", muted=True, top=22),
                ignore("nothing happens until you open the link."),
            ]),
        ),
        # Sent by netlify/functions/send-app-link.mjs - the "where is the app?" answer.
        "magic-link.html": shell(
            origin=origin,
            title="Your link to TNT Operations",
            preheader="Open TNT Operations - no password needed this time.",
            heading="Your link to TNT Operations",
            body="\n".join([
                para("Here is the app, and a way straight into it &mdash; this link signs you in, so you "
                     "don&rsquo;t need your password this time."),
                button("Open TNT Operations"),
                fallback(),
                para("Once you are in, bookmark it or add it to your home screen: TNT installs like an app "
                     "and keeps working offline in the field.", muted=True, top=22),
                para("The link works once and expires in an hour.", muted=True, top=10),
                ignore("an unopened link does nothing."),
            ]),
        ),
        "reset-password.html": shell(
            origin=origin,
            title="Reset your TNT Operations password",
            preheader="Choose a new password for TNT Operations.",
            heading="Reset your password",
            body="\n".join([
                para("Someone asked to reset the password on this account. Choose a new one here."),
                button("Choose a new password"),
                fallback(),
                para("The link works once and expires in an hour.", muted=True, top=22),
                ignore("your current password keeps working."),
            ]),
        ),
        "confirm-signup.html": shell(
            origin=origin,
            title="Confirm your email address",
            preheader="Confirm your address to finish setting up TNT Operations.",
            heading="Confirm your email address",
            body="\n".join([
                para("Confirm this address to finish setting up your TNT Operations account."),
                button("Confirm my email"),
                fallback(),
                ignore("the account stays inactive until you confirm."),
            ]),
        ),
        "change-email.html": shell(
            origin=origin,
            title="Confirm your new email address",
            preheader="Confirm the new address on your TNT Operations account.",
            heading="Confirm your new email address",
            body="\n".join([
                para(f'Your TNT Operations sign-in is changing to <span style="color:{INK_50};">'
                     "{{ .NewEmail }}</span>. Confirm it to make the change."),
                button("Confirm the change"),
                fallback(),
                ignore("your sign-in address stays as it is."),
            ]),
        ),
        "reauthentication.html": shell(
            origin=origin,
            title="Your TNT Operations confirmation code",
            preheader="Your confirmation code for TNT Operations.",
            heading="Your confirmation code",
            body="\n".join([
                para("Enter this code in TNT Operations to confirm it is you."),
                f"""            <p style="margin:26px 0 0 0;padding:18px;background:{INK_950};border:1px solid {INK_600};
                border-radius:8px;font-family:{MONO};font-size:30px;letter-spacing:.28em;
                font-weight:700;color:{HONEY};text-align:center;">{{{{ .Token }}}}</p>""",
                para("The code expires in a few minutes.", muted=True, top=22),
                ignore("nobody can act on a code you never enter."),
            ]),
        ),
    }


def build_logo() -> None:
    """
    Matte the mark onto the card colour rather than shipping transparency.

    A transparent PNG on a client that ignores `bgcolor` puts a honey mark on
    white - legible, but weak. A self-contained dark tile looks the same
    everywhere, and mail is not the place to discover which client you got.
    """
    from PIL import Image

    src = Image.open(LOGO_SRC).convert("RGBA")
    box = src.getbbox()          # trim the transparent margin the source carries
    if box:
        src = src.crop(box)

    size, inset = 176, 26        # 2x the 44px it renders at, with breathing room
    mark = size - inset * 2
    w, h = src.size
    scale = mark / max(w, h)
    src = src.resize((max(1, round(w * scale)), max(1, round(h * scale))), Image.LANCZOS)

    tile = Image.new("RGBA", (size, size), INK_850)
    tile.paste(src, ((size - src.width) // 2, (size - src.height) // 2), src)
    LOGO_OUT.parent.mkdir(parents=True, exist_ok=True)
    tile.convert("RGB").save(LOGO_OUT, optimize=True)
    print(f"  public/email/logo.png  ({LOGO_OUT.stat().st_size // 1024} KB, {size}x{size})")


def main() -> None:
    ap = argparse.ArgumentParser(description="Build the Supabase auth email templates.")
    ap.add_argument("--origin", default=DEFAULT_ORIGIN,
                    help=f"where the logo is served from (default {DEFAULT_ORIGIN})")
    args = ap.parse_args()

    OUT.mkdir(parents=True, exist_ok=True)
    print(f"Building against {args.origin}")
    for name, html in templates(args.origin).items():
        (OUT / name).write_text(html, encoding="utf-8")
        print(f"  supabase/email-templates/{name}")
    build_logo()


if __name__ == "__main__":
    main()
