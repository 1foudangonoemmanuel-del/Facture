import {
    BadRequestException,
    ForbiddenException,
    Injectable,
    NotFoundException,
} from '@nestjs/common';
import { PrismaService } from './prisma.service';

const VALID_ROLES = ['ADMIN', 'MANAGER', 'CAISSE', 'SERVER'];

@Injectable()
export class UsersService {
    constructor(private readonly prisma: PrismaService) { }

    findAll() {
        return this.prisma.user.findMany({
            omit: {
                pin: true,
            },
            orderBy: [
                {
                    role: 'asc',
                },
                {
                    name: 'asc',
                },
            ],
        });
    }

    async findOne(id: number) {
        const user = await this.prisma.user.findUnique({
            where: { id },
            omit: {
                pin: true,
            },
        });

        if (!user) {
            throw new NotFoundException('Utilisateur introuvable');
        }

        return user;
    }

    async create(data: {
        name: string;
        pin?: string;
        role?: string;
        actorUserId?: number;
    }) {
        const name = data.name?.trim();
        const pin = data.pin?.trim() || null;
        const role = data.role || 'SERVER';

        if (!name) {
            throw new BadRequestException('Nom utilisateur obligatoire');
        }

        if (!pin) {
            throw new BadRequestException('Code PIN obligatoire');
        }

        if (!VALID_ROLES.includes(role)) {
            throw new BadRequestException('Rôle invalide');
        }

        const user = await this.prisma.user.create({
            data: {
                name,
                pin,
                role,
                active: true,
                blocked: false,
            },
        });

        await this.logAction({
            action: 'CREATE_USER',
            actorUserId: data.actorUserId,
            targetType: 'USER',
            targetId: user.id,
            details: `Création utilisateur ${user.name} avec rôle ${user.role}`,
        });

        const { pin: _pin, ...safeUser } = user;

        return safeUser;
    }

    async updateRole(
        id: number,
        data: {
            role: string;
            actorUserId?: number;
        },
    ) {
        const user = await this.findOne(id);

        if (!VALID_ROLES.includes(data.role)) {
            throw new BadRequestException('Rôle invalide');
        }

        const updated = await this.prisma.user.update({
            where: { id },
            data: {
                role: data.role,
            },
        });

        await this.logAction({
            action: 'UPDATE_ROLE',
            actorUserId: data.actorUserId,
            targetType: 'USER',
            targetId: id,
            details: `Rôle de ${user.name} modifié : ${user.role} → ${data.role}`,
        });

        const { pin: _pin, ...safeUser } = updated;

        return safeUser;
    }

    async blockUser(id: number, actorUserId?: number) {
        const user = await this.findOne(id);

        const updated = await this.prisma.user.update({
            where: { id },
            data: {
                blocked: true,
                active: true,
            },
        });

        await this.logAction({
            action: 'BLOCK_USER',
            actorUserId,
            targetType: 'USER',
            targetId: id,
            details: `Compte bloqué : ${user.name}`,
        });

        const { pin: _pin, ...safeUser } = updated;

        return safeUser;
    }

    async unblockUser(id: number, actorUserId?: number) {
        const user = await this.findOne(id);

        const updated = await this.prisma.user.update({
            where: { id },
            data: {
                blocked: false,
                active: true,
            },
        });

        await this.logAction({
            action: 'UNBLOCK_USER',
            actorUserId,
            targetType: 'USER',
            targetId: id,
            details: `Compte débloqué : ${user.name}`,
        });

        const { pin: _pin, ...safeUser } = updated;

        return safeUser;
    }

    async deleteUser(id: number, actorUserId?: number) {
        const user = await this.findOne(id);

        if (actorUserId && Number(actorUserId) === Number(id)) {
            throw new ForbiddenException('Tu ne peux pas supprimer ton propre compte');
        }

        await this.logAction({
            action: 'DELETE_USER',
            actorUserId,
            targetType: 'USER',
            targetId: id,
            details: `Compte supprimé définitivement : ${user.name}`,
        });

        await this.prisma.$transaction(async (tx) => {
            await tx.table.updateMany({
                where: {
                    responsibleUserId: id,
                },
                data: {
                    responsibleUserId: null,
                },
            });

            await tx.table.updateMany({
                where: {
                    createdByUserId: id,
                },
                data: {
                    createdByUserId: null,
                },
            });

            await tx.invoice.updateMany({
                where: {
                    responsibleUserId: id,
                },
                data: {
                    responsibleUserId: null,
                },
            });

            await tx.invoice.updateMany({
                where: {
                    createdByUserId: id,
                },
                data: {
                    createdByUserId: null,
                },
            });

            await tx.invoice.updateMany({
                where: {
                    validatedByUserId: id,
                },
                data: {
                    validatedByUserId: null,
                },
            });

            await tx.invoice.updateMany({
                where: {
                    discountByUserId: id,
                },
                data: {
                    discountByUserId: null,
                },
            });

            await tx.invoice.updateMany({
                where: {
                    deferredByUserId: id,
                },
                data: {
                    deferredByUserId: null,
                },
            });

            await tx.item.updateMany({
                where: {
                    addedByUserId: id,
                },
                data: {
                    addedByUserId: null,
                },
            });

            await tx.item.updateMany({
                where: {
                    updatedByUserId: id,
                },
                data: {
                    updatedByUserId: null,
                },
            });

            await tx.payment.updateMany({
                where: {
                    receivedByUserId: id,
                },
                data: {
                    receivedByUserId: null,
                },
            });

            await tx.activityLog.updateMany({
                where: {
                    actorUserId: id,
                },
                data: {
                    actorUserId: null,
                },
            });

            await tx.user.delete({
                where: {
                    id,
                },
            });
        });

        return {
            success: true,
            deletedUserId: id,
            deletedUserName: user.name,
        };
    }

    private async logAction(data: {
        action: string;
        actorUserId?: number;
        targetType?: string;
        targetId?: number;
        details?: string;
    }) {
        try {
            await this.prisma.activityLog.create({
                data: {
                    action: data.action,
                    actorUserId: data.actorUserId || null,
                    targetType: data.targetType || null,
                    targetId: data.targetId || null,
                    details: data.details || null,
                },
            });
        } catch {
            // Ne jamais bloquer une action parce que le log échoue.
        }
    }
}
