resource "cloudflare_workers_kv_namespace" "state" {
  title = "KV_TERRAFORM_STATE"

  // Think twice before changing prevent_destroy
  lifecycle {
    prevent_destroy = true
  }
}

resource "local_file" "wrangler_toml" {
  filename = "./cf-worker/wrangler.toml"
  content  = <<-EOT
    # THIS FILE IS MANAGED BY TERRAFORM
    # MAKE CHANGES TO 'cf-worker.tf'
    
    name = "zero-trust-terraform-state"
    type = "javascript"
    workers_dev = false
    compatibility_date = "2021-10-02"

    zone_id = "${data.cloudflare_zone.state.id}"
    routes = ["${local.config.general.subdomain}.${local.config.general.zone_name}/*"]

    kv_namespaces = [ 
        { binding = "KV_TF_STATE", id = "${cloudflare_workers_kv_namespace.state.id}" }
    ]

    [durable_objects]
    classes = [
        { binding = "DO_TF_STATE", class_name = "TerraformStateDurableObject" },
        { binding = "DO_TF_STATE_INDEX", class_name = "TerraformStateIndexDurableObject" },
    ]

    [[migrations]]
    tag = "v1"
    new_classes = ["TerraformStateDurableObject"]

    [[migrations]]
    tag = "v2"
    new_classes = ["TerraformStateIndexDurableObject"]

    [triggers]
    crons = ["* * * * *"]

    [build]
    command = "yarn install && yarn build"
    cwd = "."
    watch_dir = "src"

    [build.upload]
    format = "modules"
    main = "main.mjs"
  EOT
}

resource "null_resource" "wrangler_publish" {
  depends_on = [
    local_file.wrangler_toml,
  ]

  triggers = {
    always = uuid()
  }

  provisioner "local-exec" {
    working_dir = "cf-worker"
    command     = "wrangler publish"
  }
}