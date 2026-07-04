import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from './prisma.service';

@Injectable()
export class TablesService {
    constructor(private readonly prisma: PrismaService) { }

    findAll() {
        return this.prisma.table.findMany({
            orderBy: {
                createdAt: 'asc',
            },
            include: {
                responsibleUser: true,
                createdByUser: true,
                invoices: {
                    include: {
                        items: true,
                    },
                },
            },
        });
    }

    async findOne(id: number) {
        const table = await this.prisma.table.findUnique({
            where: { id },
            include: {
                responsibleUser: true,
                createdByUser: true,
                invoices: {
                    include: {
                        items: true,
                    },
                },
            },
        });

        if (!table) {
            throw new NotFoundException('Table introuvable');
        }

        return table;
    }

    async create(data: {
        name: string;
        responsibleUserId?: number;
        createdByUserId?: number;
    }) {
        const name = data.name?.trim();

        if (!name) {
            throw new BadRequestException('Le nom de la table est obligatoire');
        }

        const table = await this.prisma.table.create({
            data: {
                name,
                responsibleUserId: data.responsibleUserId || null,
                createdByUserId: data.createdByUserId || null,
            },
        });

        await this.prisma.activityLog.create({
            data: {
                action: 'CREATE_TABLE',
                actorUserId: data.createdByUserId || null,
                tableId: table.id,
                details: `Création de la table ${table.name}`,
            },
        });

        return table;
    }

    async update(
        id: number,
        data: {
            name?: string;
            status?: string;
            actorUserId?: number;
        },
    ) {
        const existingTable = await this.findOne(id);

        if (data.status === 'CLOSED') {
            const openInvoices = existingTable.invoices.filter((invoice) => {
                return invoice.status !== 'PAID' && invoice.status !== 'CANCELLED';
            });

            if (openInvoices.length) {
                throw new BadRequestException(
                    'Impossible de fermer une table avec des factures ouvertes',
                );
            }
        }

        const table = await this.prisma.table.update({
            where: { id },
            data: {
                ...(data.name !== undefined ? { name: data.name.trim() } : {}),
                ...(data.status !== undefined ? { status: data.status } : {}),
            },
        });

        await this.prisma.activityLog.create({
            data: {
                action: 'UPDATE_TABLE',
                actorUserId: data.actorUserId || null,
                tableId: table.id,
                details: `Modification de la table ${table.name}`,
            },
        });

        return table;
    }

    async move(
        id: number,
        data: {
            responsibleUserId: number;
            actorUserId?: number;
        },
    ) {
        await this.findOne(id);

        if (!data.responsibleUserId) {
            throw new BadRequestException('responsibleUserId est obligatoire');
        }

        const targetUser = await this.prisma.user.findUnique({
            where: { id: data.responsibleUserId },
        });

        if (!targetUser) {
            throw new NotFoundException('Utilisateur responsable introuvable');
        }

        const table = await this.prisma.table.update({
            where: { id },
            data: {
                responsibleUserId: data.responsibleUserId,
            },
        });

        await this.prisma.activityLog.create({
            data: {
                action: 'MOVE_TABLE',
                actorUserId: data.actorUserId || null,
                tableId: table.id,
                targetType: 'USER',
                targetId: targetUser.id,
                details: `Table ${table.name} déplacée vers ${targetUser.name}`,
            },
        });

        return table;
    }
}
