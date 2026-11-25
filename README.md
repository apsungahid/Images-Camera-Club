# Images Camera Club of Cebu — website

https://www.imagescameraclub.com · Node.js 22, Express, EJS, SQLite.

## Run it locally

```powershell
npm install
copy .env.example .env     # then set SESSION_SECRET to a long random string
npm run seed-demo          # optional: sample activities and announcements
npm run create-admin -- "Your Name"   # prints a one-time admin invite code
npm run dev                # http://localhost:3001
```

Open `/join`, enter the admin code and create your account. From **Admin › Invite codes** you can
then create invite codes for members.

## Tests

```powershell
npm test
```

## Where things are

| Path | What |
|---|---|
| `src/site.js` | Club name, tagline, social links, hero photo |
| `src/routes/` | Public pages, sign-in, member account, admin |
| `migrations/` | Database schema (applied automatically on start) |
| `views/` | Page templates; `layout.ejs` wraps every page |
| `public/css/site.css` | All styles |
| `public/images/hero.jpg` | Optional homepage photo (about 2400 px wide) |
| `docs/SERVER.md` | Server, domain and deploy setup (shared server with the HRIS) |

## Roles

- **Guest:** public pages, and public activities and announcements.
- **Member:** also sees members-only activities and announcements, and has an account page.
- **Admin:** invite codes, members (role, suspend, password reset codes), announcements, activities.

Sign-in is by username and password (joined with an admin's invite code) or by Google once
`GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are set.
