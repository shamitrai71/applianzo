# Applianzo — Kitchen Essentials, Reviewed

Amazon affiliate marketing site for kitchen appliances with user accounts and admin panel.

## Files

| File | Description |
|------|-------------|
| `index.html` | Entry point — redirects to splash screen |
| `applianzo-splash.html` | Animated splash screen |
| `applianzo.html` | Main product listing site |
| `applianzo-login.html` | Login / signup page (users & admins) |
| `applianzo-profile.html` | User profile page |
| `applianzo-admin.html` | Admin panel (credential-gated) |
| `_redirects` | Netlify routing rules |
| `netlify.toml` | Netlify deployment config |

## Deploy to Netlify

1. Push all files to the **root** of your GitHub repo
2. Connect repo to Netlify
3. Build command: *(leave blank)*
4. Publish directory: `.`
5. Deploy

## Admin Access

- Super Admin: `esraigroup@gmail.com` / `Esrai@2025#Super`
- Access via: `yoursite.com/admin` or the login page

## User Flow

```
yoursite.com → Splash → Main Site → Login → Profile
                                          → Admin Panel (admins only)
```
