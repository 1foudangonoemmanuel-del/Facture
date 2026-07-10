import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AppController } from './app.controller';
import { PrismaService } from './prisma.service';
import { BryxAuthGuard } from './auth.guard';

import { UsersController } from './users.controller';
import { UsersService } from './users.service';

import { TablesController } from './tables.controller';
import { TablesService } from './tables.service';

import { InvoicesController } from './invoices.controller';
import { InvoicesService } from './invoices.service';

import { ItemsController } from './items.controller';
import { ItemsService } from './items.service';

import { ProductsController } from './products.controller';
import { ProductsService } from './products.service';

import { RecapController } from './recap.controller';
import { RecapService } from './recap.service';

import { ActivityLogsController } from './activity-logs.controller';
import { ActivityLogsService } from './activity-logs.service';

import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { RealtimeService } from './realtime.service';

@Module({
  imports: [],
  controllers: [
    AppController,

    UsersController,
    TablesController,
    InvoicesController,
    ItemsController,
    ProductsController,

    RecapController,
    ActivityLogsController,
    AuthController,
  ],
  providers: [
    PrismaService,

    UsersService,
    TablesService,
    InvoicesService,
    ItemsService,
    ProductsService,

    RecapService,
    ActivityLogsService,
    AuthService,
    RealtimeService,
    {
      provide: APP_GUARD,
      useClass: BryxAuthGuard,
    },
  ],
})
export class AppModule { }
