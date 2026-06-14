import crypto from "node:crypto";

import pg from "pg";

import type {
  CommitmentRecord,
  CreatePetitionInput,
  PetitionRecord,
  PetitionStatus,
  PetitionStore,
  UpsertCommitmentInput,
} from "./types";

const { Pool } = pg;

type MemoryState = {
  petitions: Map<string, PetitionRecord>;
  commitments: Map<string, CommitmentRecord[]>;
};

type PetitionRow = {
  id: string;
  contract_petition_id: string | null;
  title: string;
  token0_symbol: string;
  token1_symbol: string;
  token0_address: string | null;
  token1_address: string | null;
  fee: number;
  threshold_usd_e18: string;
  status: PetitionStatus;
  commitment_count: number | string;
  created_at: Date | string;
  updated_at: Date | string;
};

type CommitmentRow = {
  id: string;
  petition_id: string;
  signer: string;
  amount0: string;
  amount1: string;
  tx_hash: string | null;
  order_index: number;
  created_at: Date | string;
  updated_at: Date | string;
};

type GlobalWithPetitions = typeof globalThis & {
  __lpPetitionsMemory?: MemoryState;
  __lpPetitionsPool?: pg.Pool;
  __lpPetitionsSchemaReady?: Promise<void>;
};

function nowIso() {
  return new Date().toISOString();
}

function toIso(value: Date | string) {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function mapPetition(row: PetitionRow): PetitionRecord {
  return {
    id: row.id,
    contractPetitionId: row.contract_petition_id,
    title: row.title,
    token0Symbol: row.token0_symbol,
    token1Symbol: row.token1_symbol,
    token0Address: row.token0_address as PetitionRecord["token0Address"],
    token1Address: row.token1_address as PetitionRecord["token1Address"],
    fee: Number(row.fee),
    thresholdUsdE18: row.threshold_usd_e18,
    status: row.status,
    commitmentCount: Number(row.commitment_count ?? 0),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

function mapCommitment(row: CommitmentRow): CommitmentRecord {
  return {
    id: row.id,
    petitionId: row.petition_id,
    signer: row.signer as CommitmentRecord["signer"],
    amount0: row.amount0,
    amount1: row.amount1,
    txHash: row.tx_hash as CommitmentRecord["txHash"],
    orderIndex: Number(row.order_index),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

function getMemoryState(): MemoryState {
  const globalForPetitions = globalThis as GlobalWithPetitions;
  globalForPetitions.__lpPetitionsMemory ??= {
    petitions: new Map(),
    commitments: new Map(),
  };
  return globalForPetitions.__lpPetitionsMemory;
}

const memoryStore: PetitionStore = {
  async listPetitions() {
    const state = getMemoryState();
    return [...state.petitions.values()]
      .map((petition) => ({
        ...petition,
        commitmentCount: state.commitments.get(petition.id)?.length ?? 0,
      }))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  },

  async createPetition(input) {
    const state = getMemoryState();
    const timestamp = nowIso();
    const petition: PetitionRecord = {
      id: crypto.randomUUID(),
      contractPetitionId: input.contractPetitionId ?? null,
      title: input.title,
      token0Symbol: input.token0Symbol,
      token1Symbol: input.token1Symbol,
      token0Address: input.token0Address ?? null,
      token1Address: input.token1Address ?? null,
      fee: input.fee,
      thresholdUsdE18: input.thresholdUsdE18,
      status: "open",
      commitmentCount: 0,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    state.petitions.set(petition.id, petition);
    state.commitments.set(petition.id, []);
    return petition;
  },

  async getPetition(id) {
    const state = getMemoryState();
    const petition = state.petitions.get(id);
    if (!petition) return null;
    const commitments = state.commitments.get(id) ?? [];
    return {
      petition: { ...petition, commitmentCount: commitments.length },
      commitments: [...commitments].sort((a, b) => a.orderIndex - b.orderIndex),
    };
  },

  async upsertCommitment(petitionId, input) {
    const state = getMemoryState();
    const petition = state.petitions.get(petitionId);
    if (!petition) return null;

    const timestamp = nowIso();
    const commitments = state.commitments.get(petitionId) ?? [];
    const existingIndex = commitments.findIndex(
      (commitment) => commitment.signer.toLowerCase() === input.signer.toLowerCase(),
    );

    if (existingIndex >= 0) {
      commitments[existingIndex] = {
        ...commitments[existingIndex],
        amount0: input.amount0,
        amount1: input.amount1,
        txHash: input.txHash ?? null,
        updatedAt: timestamp,
      };
    } else {
      commitments.push({
        id: crypto.randomUUID(),
        petitionId,
        signer: input.signer,
        amount0: input.amount0,
        amount1: input.amount1,
        txHash: input.txHash ?? null,
        orderIndex: commitments.length,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
    }

    state.commitments.set(petitionId, commitments);
    state.petitions.set(petitionId, {
      ...petition,
      commitmentCount: commitments.length,
      updatedAt: timestamp,
    });

    return memoryStore.getPetition(petitionId);
  },

  async markExecuted(id) {
    const state = getMemoryState();
    const petition = state.petitions.get(id);
    if (!petition) return;
    state.petitions.set(id, { ...petition, status: "executed", updatedAt: nowIso() });
  },
};

function hasDatabaseUrl() {
  return Boolean(process.env.DATABASE_URL);
}

function getPool() {
  const globalForPetitions = globalThis as GlobalWithPetitions;
  if (!globalForPetitions.__lpPetitionsPool) {
    globalForPetitions.__lpPetitionsPool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : undefined,
    });
  }
  return globalForPetitions.__lpPetitionsPool;
}

async function ensureSchema() {
  const globalForPetitions = globalThis as GlobalWithPetitions;
  globalForPetitions.__lpPetitionsSchemaReady ??= getPool().query(`
    CREATE TABLE IF NOT EXISTS lp_petitions (
      id TEXT PRIMARY KEY,
      contract_petition_id TEXT UNIQUE,
      title TEXT NOT NULL,
      token0_symbol TEXT NOT NULL,
      token1_symbol TEXT NOT NULL,
      token0_address TEXT,
      token1_address TEXT,
      fee INTEGER NOT NULL CHECK (fee >= 0 AND fee <= 16777215),
      threshold_usd_e18 TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('open', 'executed')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS lp_commitments (
      id TEXT PRIMARY KEY,
      petition_id TEXT NOT NULL REFERENCES lp_petitions(id) ON DELETE CASCADE,
      signer TEXT NOT NULL,
      amount0 TEXT NOT NULL,
      amount1 TEXT NOT NULL,
      tx_hash TEXT,
      order_index INTEGER NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (petition_id, signer),
      UNIQUE (petition_id, order_index)
    );
  `).then(() => undefined);
  return globalForPetitions.__lpPetitionsSchemaReady;
}

async function getPetitionRow(id: string) {
  await ensureSchema();
  const result = await getPool().query<PetitionRow>(
    `SELECT p.*, COUNT(c.id)::int AS commitment_count
     FROM lp_petitions p
     LEFT JOIN lp_commitments c ON c.petition_id = p.id
     WHERE p.id = $1
     GROUP BY p.id`,
    [id],
  );
  return result.rows[0] ? mapPetition(result.rows[0]) : null;
}

const postgresStore: PetitionStore = {
  async listPetitions() {
    await ensureSchema();
    const result = await getPool().query<PetitionRow>(
      `SELECT p.*, COUNT(c.id)::int AS commitment_count
       FROM lp_petitions p
       LEFT JOIN lp_commitments c ON c.petition_id = p.id
       GROUP BY p.id
       ORDER BY p.created_at DESC`,
    );
    return result.rows.map(mapPetition);
  },

  async createPetition(input: CreatePetitionInput) {
    await ensureSchema();
    const id = crypto.randomUUID();
    const result = await getPool().query<PetitionRow>(
      `INSERT INTO lp_petitions (
         id, contract_petition_id, title, token0_symbol, token1_symbol,
         token0_address, token1_address, fee, threshold_usd_e18, status
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'open')
       RETURNING *, 0::int AS commitment_count`,
      [
        id,
        input.contractPetitionId ?? null,
        input.title,
        input.token0Symbol,
        input.token1Symbol,
        input.token0Address ?? null,
        input.token1Address ?? null,
        input.fee,
        input.thresholdUsdE18,
      ],
    );
    return mapPetition(result.rows[0]);
  },

  async getPetition(id) {
    const petition = await getPetitionRow(id);
    if (!petition) return null;

    const commitments = await getPool().query<CommitmentRow>(
      `SELECT * FROM lp_commitments
       WHERE petition_id = $1
       ORDER BY order_index ASC`,
      [id],
    );

    return {
      petition,
      commitments: commitments.rows.map(mapCommitment),
    };
  },

  async upsertCommitment(petitionId: string, input: UpsertCommitmentInput) {
    await ensureSchema();
    const pool = getPool();
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const petition = await client.query<{ id: string }>(
        "SELECT id FROM lp_petitions WHERE id = $1 FOR UPDATE",
        [petitionId],
      );
      if (!petition.rows[0]) {
        await client.query("ROLLBACK");
        return null;
      }

      const existing = await client.query<CommitmentRow>(
        "SELECT * FROM lp_commitments WHERE petition_id = $1 AND signer = $2",
        [petitionId, input.signer],
      );

      if (existing.rows[0]) {
        await client.query(
          `UPDATE lp_commitments
           SET amount0 = $3, amount1 = $4, tx_hash = $5, updated_at = NOW()
           WHERE petition_id = $1 AND signer = $2`,
          [petitionId, input.signer, input.amount0, input.amount1, input.txHash ?? null],
        );
      } else {
        const nextOrder = await client.query<{ order_index: number }>(
          "SELECT COALESCE(MAX(order_index) + 1, 0)::int AS order_index FROM lp_commitments WHERE petition_id = $1",
          [petitionId],
        );
        await client.query(
          `INSERT INTO lp_commitments (
             id, petition_id, signer, amount0, amount1, tx_hash, order_index
           ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            crypto.randomUUID(),
            petitionId,
            input.signer,
            input.amount0,
            input.amount1,
            input.txHash ?? null,
            nextOrder.rows[0].order_index,
          ],
        );
      }

      await client.query("UPDATE lp_petitions SET updated_at = NOW() WHERE id = $1", [petitionId]);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }

    return postgresStore.getPetition(petitionId);
  },

  async markExecuted(id: string) {
    await ensureSchema();
    await getPool().query(
      "UPDATE lp_petitions SET status = 'executed', updated_at = NOW() WHERE id = $1",
      [id],
    );
  },
};

export function getPetitionStore(): PetitionStore {
  return hasDatabaseUrl() ? postgresStore : memoryStore;
}
