resource "cloudflare_record" "state" {
  zone_id = data.cloudflare_zone.state.id
  name    = "${local.config.general.subdomain}.${local.config.general.zone_name}"
  value   = "100::"
  type    = "AAAA"
  proxied = true
}
