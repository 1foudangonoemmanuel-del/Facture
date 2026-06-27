import { Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import * as path from 'path';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit {
    constructor() {
        const dbPath = path.join(process.cwd(), 'dev.db').replace(/\\/g, '/');

        const adapter = new PrismaBetterSqlite3({
            url: `file:${dbPath}`,
        });

        super({ adapter });
    }

    async onModuleInit() {
        await this.$connect();
    }
}