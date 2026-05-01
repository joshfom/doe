# Design Document: ORA AI Assistant

## Overview

ORA AI is an autonomous virtual assistant that acts as a digital employee for ORA's real estate community platform. It provides personalized, context-aware responses to clients and tenants by combining structured account data with a curated knowledge base through a Retrieval-Augmented Generation (RAG) pipeline.

The system integrates into the existing ORA CMS Platform stack:
- **Frontend**: Next.js App Router with a floating chat widget component
- **API**: Elysia.js routes under `/api/ai/*` following existing route patterns
- **Database**: PostgreSQL with Drizzle ORM, extended with pgvector for embeddings
- **Auth**: Better Auth for session-based identity resolution
- **AI Gateway**: Cloudflare AI Gateway for model access (reasoning, tool calling, embeddings)
- **State Management**: TanStack Query for admin panel data fetching

### Key Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Vector storage | pgvector in PostgreSQL | Single database, no additional infrastructure, native SQL integration with Drizzle |
| AI model access | Cloudflare AI Gateway | Centralized model routing, rate limiting, caching, analytics, supports multiple providers |
| Embedding model | Cloudflare Workers AI (bge-base-en-v1.5 / bge-m3 for multilingual) | Low latency via Cloudflare edge, supports EN/AR, 768-dimension vectors |
| Chat API pattern | Stateless POST endpoint with conversation ID | Simple, scalable, no WebSocket complexity needed for this use case |
| Content sync | Event-driven hooks in existing blog service | No polling, immediate indexing on publish/update/delete |
| Admin panel | New routes under `/ora-panel/ai/*` | Follows existing admin panel structure |
| Property testing | fast-check (already in devDependencies) | Consistent with existing project test infrastructure |

## Architecture

### System Architecture Diagram

```mermaid
graph TB
    subgraph "Public Frontend"
        CW[Chat Widget]
    end

    subgraph "Admin Panel"
        KB[Knowledge Base Manager]
        CV[Conversation Viewer]
        AN[Analytics Dashboard]
        CF[AI Configuration]
        AP[Appointment Manager]
        CR[Client/Tenant/Unit CRUD]
    end

    subgraph "API Layer (Elysia.js)"
        CHAT[POST /api/ai/chat]
        CONV[GET /api/ai/conversations]
        KBAPI[CRUD /api/ai/knowledge-base]
        CLAPI[CRUD /api/ai/clients]
        APAPI[CRUD /api/ai/appointments]
        ANAPI[GET /api/ai/analytics]
    end

    subgraph "AI Core (lib/cms/ai/)"
        ID[Identity Resolver]
        RAG[RAG Pipeline]
        SCOPE[Scope Boundary Checker]
        ACTIONS[Action Executor]
        SYNC[Content Sync]
        LANG[Language Detector]
    end

    subgraph "External Services"
        CFAI[Cloudflare AI Gateway]
        EMB[Embedding Model]
        LLM[Language Model]
    end

    subgraph "Database (PostgreSQL + pgvector)"
        VS[(Vector Store)]
        CLIENTS[(Client Records)]
        TENANTS[(Tenant Records)]
        UNITS[(Unit Records)]
        CONVDB[(Conversations)]
        MSGDB[(Messages)]
        APTDB[(Appointments)]
        KDDB[(Knowledge Documents)]
        AICONF[(AI Config)]
    end

    CW --> CHAT
    KB --> KBAPI
    CV --> CONV
    AN --> ANAPI
    CR --> CLAPI
    AP --> APAPI

    CHAT --> ID
    CHAT --> LANG
    CHAT --> SCOPE
    CHAT --> RAG
    CHAT --> ACTIONS

    RAG --> CFAI
    CFAI --> EMB
    CFAI --> LLM

    RAG --> VS
    RAG --> KDDB
    ID --> CLIENTS
    ID --> TENANTS
    ACTIONS --> APTDB
    SYNC --> KDDB
    SYNC --> VS
