# export CF_ACCESS_APP_URL=https://terraform-state.eidam.cf/auth 
# export TF_HTTP_USERNAME=jwt
# export TF_HTTP_PASSWORD=$(cloudflared access login ${CF_ACCESS_APP_URL} > /dev/null && cloudflared access token --app=${CF_ACCESS_APP_URL})

# if no cloudflared, you can go to https://state.eidam.dev, login with your email and copy the "CF_Authorization" cookie value

terraform {
  backend "http" {
    address = "https://terraform-state.eidam.cf/user/hello@eidam.cf/state"
    # Optional
    lock_address = "https://terraform-state.eidam.cf/user/hello@eidam.cf/state"
    unlock_address = "https://terraform-state.eidam.cf/user/hello@eidam.cf/state"
  }
}
