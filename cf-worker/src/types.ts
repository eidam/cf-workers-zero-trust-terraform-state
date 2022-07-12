export interface Env {
  CF_ACCESS_APP_AUD: string;

  KV_TF_STATE: KVNamespace;
  DO_TF_STATE: DurableObjectNamespace;
  DO_TF_STATE_INDEX: DurableObjectNamespace;
}

export interface StateConfig {
  access: Access;
  issuers: Issuer[];
  policies: Policy[];
}

export interface Access {
  emails: string[];
  everyone: boolean;
}

export interface Issuer {
  id: string;
  iss: string;
  jwks_uri?: string;
  name: string;
  job_url?: string;
}

export interface Policy {
  jwts: Jwt[];
  path: string;
}

export interface Jwt {
  issuer_id: string;
  scope: string;
  claims?: Claims;
  ignore_url_params_claims?: boolean;
}

export interface Claims {
  [name: string]: number | string | string[];
}
