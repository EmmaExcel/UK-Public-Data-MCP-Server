# Hosted UI on Hugging Face Spaces (free)

This folder deploys Open WebUI as a public web frontend for the MCP server,
without paying for a Render instance. It runs as a Hugging Face Docker Space.

## What you need

- A free Hugging Face account and a token: https://huggingface.co/settings/tokens
- The MCP server already running on Render (or any public URL) from `render.yaml`

## Deploy

1. Go to https://huggingface.co/new-space
2. Name it `uk-public-data-mcp-ui`
3. SDK: **Docker** → **Blank**
4. Visibility: **Public** (so recruiters can open it)
5. Create the Space, then push this folder to the Space repo:

   ```bash
   git clone https://huggingface.co/spaces/YOUR_USERNAME/uk-public-data-mcp-ui
   cd uk-public-data-mcp-ui
   cp /path/to/uk-public-data-mcp/huggingface-space/Dockerfile .
   git add Dockerfile
   git commit -m "Add Open WebUI Dockerfile"
   git push
   ```

6. In the Space settings, add these **Variables and secrets**:

   | Name | Value | Type |
   | --- | --- | --- |
   | `WEBUI_AUTH` | `false` | variable |
   | `MCP_SERVER_CONNECTIONS` | `[{"name":"uk-public-data","type":"streamable_http","url":"https://uk-public-data-mcp.onrender.com/mcp"}]` | variable |
   | `OPENAI_API_BASE_URL` | `https://api-inference.huggingface.co/v1` | variable |
   | `OPENAI_API_KEY` | your Hugging Face token (`hf_...`) | secret |
   | `OPENAI_API_BASE_MODELS` | `mistralai/Mistral-7B-Instruct-v0.3` | variable |

7. Rebuild the Space and open it. It connects to the MCP server automatically and
   exposes the `uk-public-data` tools to the chat model.

## Notes

- `WEBUI_AUTH=false` removes the login wall so visitors can use the demo
  immediately. Anyone with the link can chat, and usage is billed to the
  Hugging Face token in `OPENAI_API_KEY` (serverless inference has rate limits).
- Free Spaces sleep after inactivity. The first visit may show a "Starting"
  page for a minute or two while it wakes up.
- Change `uk-public-data-mcp.onrender.com` in `MCP_SERVER_CONNECTIONS` if your
  MCP server is hosted elsewhere.
