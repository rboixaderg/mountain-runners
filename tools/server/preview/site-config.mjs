// Root-owned Caddy fragment: the preview identity never writes this file.
export function renderPreviewSites(pullNumbers) {
  return [...pullNumbers]
    .sort((first, second) => first - second)
    .map(
      (number) => `https://pr-${number}.preview.mountainrunners.cat {
  root * /var/lib/mountain-runners-previews/namespaces/pr-${number}/current
  header X-Robots-Tag "noindex, nofollow, noarchive"
  header X-Content-Type-Options nosniff
  header Referrer-Policy no-referrer
  header Permissions-Policy "camera=(), microphone=(), geolocation=(), payment=(), usb=()"
  header Content-Security-Policy "default-src 'self'; script-src 'self'; connect-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; frame-src https://www.youtube-nocookie.com; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; object-src 'none'"
  header Cache-Control "no-store"
  @unprefixed_root path /
  redir @unprefixed_root /ca/ permanent
  @robots path /robots.txt
  handle @robots {
    root * /etc/caddy/preview-robots
    file_server
  }
  handle {
    file_server
  }
  handle_errors {
    rewrite /404.html
    file_server
  }
  log {
    output file /var/log/mountain-runners-previews/access.log {
      roll_at 00:00
      roll_keep 7
      roll_keep_for 168h
    }
    format filter {
      request>remote_port delete
      request>client_ip delete
      request>proto delete
      request>host delete
      request>uri delete
      request>headers delete
      request>tls delete
      resp_headers delete
      bytes_read delete
      user_id delete
    }
  }
  log_append path {http.request.uri.path}
}`,
    )
    .join("\n\n");
}

export function parsePreviewSites(fragment) {
  const numbers = [
    ...fragment.matchAll(
      /^https:\/\/pr-([1-9]\d*)\.preview\.mountainrunners\.cat \{$/gmu,
    ),
  ].map((match) => Number(match[1]));
  if (fragment.trim() !== renderPreviewSites(numbers)) {
    throw new Error(
      "Preview Caddy fragment differs from the trusted template.",
    );
  }
  return numbers;
}
