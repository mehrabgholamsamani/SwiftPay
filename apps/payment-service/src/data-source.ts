import { Pool } from 'pg';

export const paymentPool = new Pool({ connectionString: process.env.DATABASE_URL });
