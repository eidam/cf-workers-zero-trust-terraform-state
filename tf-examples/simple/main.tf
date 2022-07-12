resource null_resource test {
  count = 200
  triggers = {
    uuid = uuid()
  }
}
