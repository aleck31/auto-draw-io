# AI Provider Configuration

This guide explains how to configure different AI model providers for auto-draw-io.

## Quick Start

1. Copy `.env.example` to `.env.local`
2. Set your API key for your chosen provider
3. Set `AI_MODEL` to your desired model
4. Run `npm run dev`

## Supported Providers

### AWS Bedrock

```bash
AWS_REGION=us-west-2
AWS_ACCESS_KEY_ID=your_access_key_id
AWS_SECRET_ACCESS_KEY=your_secret_access_key
AI_MODEL=anthropic.claude-sonnet-4-5-20250514-v1:0
```

Note: On AWS (Lambda, EC2 with IAM role), credentials are automatically obtained from the IAM role.

### OpenAI

```bash
OPENAI_API_KEY=your_api_key
AI_MODEL=gpt-4o
```

Optional custom endpoint (for OpenAI-compatible services):

```bash
OPENAI_BASE_URL=https://your-custom-endpoint/v1
```

### Anthropic

```bash
ANTHROPIC_API_KEY=your_api_key
AI_MODEL=claude-sonnet-4-5-20250514
```

Optional custom endpoint:

```bash
ANTHROPIC_BASE_URL=https://your-custom-endpoint
```

### Google Gemini

```bash
GOOGLE_GENERATIVE_AI_API_KEY=your_api_key
AI_MODEL=gemini-2.0-flash
```

Optional custom endpoint:

```bash
GOOGLE_BASE_URL=https://your-custom-endpoint
```

### OpenRouter

```bash
OPENROUTER_API_KEY=your_api_key
AI_MODEL=anthropic/claude-sonnet-4
```

Optional custom endpoint:

```bash
OPENROUTER_BASE_URL=https://your-custom-endpoint
```

## Auto-Detection

If you only configure **one** provider's API key, the system will automatically detect and use that provider. No need to set `AI_PROVIDER`.

If you configure **multiple** API keys, you must explicitly set `AI_PROVIDER`:

```bash
AI_PROVIDER=google  # or: openai, anthropic, bedrock, openrouter
```

## Model Capability Requirements

This task requires exceptionally strong model capabilities, as it involves generating long-form text with strict formatting constraints (draw.io XML).

**Recommended models**:

-   Claude Sonnet 4.5 / Opus 4.5

## Temperature Setting

You can optionally configure the temperature via environment variable:

```bash
TEMPERATURE=0  # More deterministic output (recommended for diagrams)
```

**Important**: Leave `TEMPERATURE` unset for models that don't support temperature settings, such as:
- GPT-5.1 and other reasoning models
- Some specialized models

When unset, the model uses its default behavior.

## Recommendations

-   **Best experience**: Use models with vision support (Claude, GPT-4o, Gemini) for image-to-diagram features
-   **Flexibility**: OpenRouter provides access to many models through a single API
-   **Budget-friendly**: DeepSeek offers competitive pricing
