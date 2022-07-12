terraform {
  // Make sure to add backend for this project
  //backend "" {}
  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 3.0"
    }
  }
}

# Single variable related to a cloudflare provider needed
variable "cf_api_token" {
  sensitive = true
}

provider "cloudflare" {
  account_id = local.config.general.account_id
  api_token  = var.cf_api_token
}
