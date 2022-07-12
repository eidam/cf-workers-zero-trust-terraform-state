locals {
  config = yamldecode(file("config.yaml"))
}

# Look for a zone in a specific account by the zone name
data "cloudflare_zone" "state" {
  name       = local.config.general.zone_name
  account_id = local.config.general.account_id
}

resource "cloudflare_access_application" "state" {
  zone_id          = data.cloudflare_zone.state.id
  name             = "Terraform state"
  domain           = "${local.config.general.subdomain}.${local.config.general.zone_name}/auth"
  type             = "self_hosted"
  session_duration = try(local.config.access.session_duration, "24h")
}

resource "cloudflare_access_policy" "state" {
  application_id = cloudflare_access_application.state.id
  zone_id        = data.cloudflare_zone.state.id
  name           = "Terraform state groups"
  precedence     = "1"
  decision       = "allow"

  include {
    group = [cloudflare_access_group.state.id]
  }
}

resource "cloudflare_access_group" "state" {
  account_id = local.config.general.account_id
  name       = "Terraform State"

  include {
    email        = try(local.config.access.include.emails, null)
    email_domain = try(local.config.access.include.email_domains, null)
    everyone     = try(local.config.access.include.everyone, null)
  }
}
