import { DataSource } from 'typeorm';
import { InitialIdentity1710000000000 } from './migrations/1710000000000-initial';
import { StageTwoIdentityRepair1710000000008 } from './migrations/1710000000008-stage-two-repair';
import { IdentityOutboxCompatibility1710000000012 } from './migrations/1710000000012-outbox-compatibility';
import { IdentityRefreshTokenCompatibility1710000000013 } from './migrations/1710000000013-refresh-token-compatibility';
export const identityDataSource = new DataSource({
  type: 'postgres',
  url: process.env.DATABASE_URL,
  migrations: [
    InitialIdentity1710000000000,
    StageTwoIdentityRepair1710000000008,
    IdentityOutboxCompatibility1710000000012,
    IdentityRefreshTokenCompatibility1710000000013,
  ],
  synchronize: false,
});
