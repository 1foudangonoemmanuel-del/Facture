import { Injectable } from '@nestjs/common';
import { PrismaService } from './prisma.service';

@Injectable()
export class ActivityLogsService {
    constructor(private readonly prisma: PrismaService) { }

    findAll() {
        return this.prisma.activityLog.findMany({
            orderBy: {
                createdAt: 'desc',
            },
            include: {
                actorUser: true,
                table: true,
                invoice: true,
            },
        });
    }

    findByInvoice(invoiceId: number) {
        return this.prisma.activityLog.findMany({
            where: {
                invoiceId,
            },
            orderBy: {
                createdAt: 'desc',
            },
            include: {
                actorUser: true,
                table: true,
                invoice: true,
            },
        });
    }

    findByTable(tableId: number) {
        return this.prisma.activityLog.findMany({
            where: {
                tableId,
            },
            orderBy: {
                createdAt: 'desc',
            },
            include: {
                actorUser: true,
                table: true,
                invoice: true,
            },
        });
    }
}