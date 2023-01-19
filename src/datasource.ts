import { IntegrationBase } from "@budibase/types"
import fetch from "node-fetch"

interface Query {[index: string]: any}
type Field = {data_name: string, key: string, type: string, choices?: [Choice]}
type Choice = {label: string, value: string}
type Record = {[index: string]: any} & {
  id?: string,
  form_id?: string
  status?: string,
  project_id?: string,
  assigned_to_id?: string,
  latitude?: number,
  longitude?: number,
  form_values: {[index: string]: any}
}

const DEFAULT_FIELDS = ["status", "project_id", "assigned_to_id", "longitude", "latitude"]

function encodeQueryParams(obj: {[index: string]: any}): string {
  const str = [];
  for (let i in obj)
    if (obj.hasOwnProperty(i)) {
      str.push(encodeURIComponent(i) + "=" + encodeURIComponent(obj[i]));
    }
  return str.join("&");
}

function UUID() {
  let d = new Date().getTime();
  let d2 = 0;
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    let r = Math.random() * 16;//random number between 0 and 16
    if(d > 0){//Use timestamp until depleted
      r = (d + r)%16 | 0;
      d = Math.floor(d/16);
    } else {//Use microseconds since page-load if supported
      r = (d2 + r)%16 | 0;
      d2 = Math.floor(d2/16);
    }
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

class CustomIntegration implements IntegrationBase {
  private readonly url: string
  private readonly token: string
  private readonly config: any

  constructor(config: { apiToken: string }) {
    this.config = config
    this.url = "https://api.fulcrumapp.com/api/v2"
    this.token = config.apiToken
  }

  async request(endpoint: string, opts: Query) {
    opts.params = opts.params ? "?" + encodeQueryParams(opts.params) : ""
    const response = await fetch(`${this.url}/${endpoint}${opts.params}`, {
      method: opts["method"],
      headers: {
        ...(opts.headers || {}),
        "Content-Type": "application/json",
        "Accept": "application/json",
        "schema": "false",
        "X-ApiToken": this.token
      },
      body: JSON.stringify(opts["body"])
    })
    if (response.status <= 300) {
      return await response.json()
    } else {
      const err = await response.text()
      throw new Error(err)
    }
  }

  async create(params: { data: { [index: string]: any }, ["form-id"]: string }) {
    const id = UUID();
    let record = await this._formatRecordToFulcrum(params.data, {id, form_id: params["form-id"], form_values: {}})
    const opts = { method: "POST", body: {record, format: "json"} }
    return this.request(`records.json`, opts)
      .then((res: {record: Record}) => this._queryRecordById(res.record))
  }

  async read(params: { q: string, format: string }) {
    const opts = { method: "POST", body: {q: params.q, format: params.format || "json"} }
    return this.request('query', opts)
  }

  async update(params: { data: { [index: string]: any }, ['record-id']: string }) {
    let record = await this.request(`records/${params["record-id"]}.json`, {})
      .then(r => r["record"])
    record = await this._formatRecordToFulcrum(params.data, record)
    const opts = { method: "PUT", body: {record, format: "json"} }
    return this.request(`records/${params["record-id"]}.json`, opts)
      .then((res: {record: Record}) => this._queryRecordById(res.record))
  }

  async delete(params: { id: string }) {
    const opts = {
      method: "DELETE",
    }
    return this.request(`records/${params.id}.json`, opts)
  }

  async _getFormFields(id: string, keys?: [string]): Promise<[Field]> {
    const form = await this.request(`forms/${id}.json`, {})
      .then(r => r["form"])
    let fields = form["elements"];
    return fields.reduce((all: [any], field: any) => {
      if (field.elements) {
        return [...all, ...field.elements]
      } else {
        return [...all, field]
      }
    }, []).filter((f: any) => !keys || keys.includes(f["data_name"]));
  }

  async _formatRecordToFulcrum(data: any, record: Record): Promise<Record> {
    try {
      data = JSON.parse(data)
    } catch (e) { throw new Error("Invalid json, could not parse data field.") }
    const keys = Object.keys(data);
    const fields = await this._getFormFields(record["form_id"] || "")
      .then(res => res.filter(f => keys.includes(f["data_name"])))
    for (let i in keys) {
      const key: string = keys[i];
      if (DEFAULT_FIELDS.includes(key)) {
        record[key] = data[key]
      } else {
        const field = fields.find((f: Field) => f.data_name == key)
        if (field) {
          switch(field.type) {
            case "Signature":
            case "RepeatableField":
            case "RecordLinkField":
              // TODO: implement above
              break;
            case "PhotoField":
            case "AudioField":
            case "VideoField":
              const name = field.type.toLowerCase().replace("field", "");
              // TODO: implement upload to fulcrum - not needed asap tho
              break;
            case "ChoiceField":
              let choices = field?.choices?.map(c => c.value)
              record["form_values"][field.key] = {
                other_values: (Array.isArray(data[field.data_name]) ?
                  data[field.data_name] : [data[field.data_name]])
                  .filter((f: string) => !choices || !choices.includes(f)),
                choice_values: (Array.isArray(data[field.data_name]) ?
                  data[field.data_name] : [data[field.data_name]])
                  .filter((f: string) => !choices || choices.includes(f))
              }
              break;
            default:
              record['form_values'][field.key] = data[field.data_name]
          }
        }
      }
    }
    return record;
  }

  _queryRecordById(record: Record) {
    return this.request("query", {
      method: "POST",
      body: {
        q: `Select * from "${record.form_id}" where _record_id = '${record.id}'`,
        format: "json"
      }
    }).then(res => res.rows[0])
  }
}

export default CustomIntegration
