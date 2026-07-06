# Penny Pincher marketing website

Static site, no build step. Marketing/landing page plus rendered versions of the
`/legal` draft documents (kept in sync manually - update both if the legal drafts
change).

## Local preview

```bash
cd website
python3 -m http.server 8123
```

## Deploy

Any static host works (Netlify, Vercel, GitHub Pages, S3 + CloudFront). Point it at
this directory; no build command is needed.
