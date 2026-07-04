import {
    BadRequestException,
    ForbiddenException,
    Injectable,
    NotFoundException,
} from '@nestjs/common';
import { PrismaService } from './prisma.service';

const PRICE_MANAGERS = ['ADMIN', 'MANAGER', 'CAISSE'];

@Injectable()
export class ItemsService {
    constructor(private readonly prisma: PrismaService) { }

    async create(
        invoiceId: number,
        data: {
            productId?: number;
            name?: string;
            quantity?: number;
            unitPrice?: number;
            addedByUserId?: number;
            actorUserId?: number;
        },
    ) {
        const invoice = await this.getEditableInvoice(invoiceId);
        const actor = await this.getActor(data.actorUserId || data.addedByUserId);

        const quantity = Math.max(1, Number(data.quantity) || 1);

        let productId: number | null = null;
        let name = '';
        let unitPrice = 0;

        if (data.productId) {
            const product = await this.prisma.product.findUnique({
                where: {
                    id: Number(data.productId),
                },
            });

            if (!product || !product.active) {
                throw new NotFoundException('Produit introuvable');
            }

            productId = product.id;
            name = product.name;
            unitPrice = product.price;

            if (
                data.unitPrice !== undefined &&
                Number(data.unitPrice) !== product.price
            ) {
                if (!this.canOverridePrice(actor.role)) {
                    throw new ForbiddenException(
                        'Le serveur ne peut pas modifier le prix catalogue',
                    );
                }

                unitPrice = Math.max(0, Number(data.unitPrice) || 0);
            }
        } else {
            if (!this.canOverridePrice(actor.role)) {
                throw new ForbiddenException(
                    'Le serveur doit choisir un article du catalogue',
                );
            }

            name = data.name?.trim() || '';
            unitPrice = Math.max(0, Number(data.unitPrice) || 0);

            if (!name) {
                throw new BadRequestException('Nom article obligatoire');
            }
        }

        const existingItem = await this.findMergeableItem(invoice.id, {
            productId,
            name,
            unitPrice,
        });

        const item = existingItem
            ? await this.prisma.item.update({
                where: {
                    id: existingItem.id,
                },
                data: {
                    quantity: existingItem.quantity + quantity,
                    updatedByUserId: actor.id,
                },
            })
            : await this.prisma.item.create({
                data: {
                    invoiceId: invoice.id,
                    productId,
                    name,
                    quantity,
                    unitPrice,
                    addedByUserId: actor.id,
                },
            });

        await this.prisma.activityLog.create({
            data: {
                action: 'ADD_ITEM',
                actorUserId: actor.id,
                invoiceId: invoice.id,
                itemId: item.id,
                details: `${actor.name} a ajouté ${name} x${quantity} à ${unitPrice} €`,
            },
        });

        return item;
    }

    async update(
        id: number,
        data: {
            name?: string;
            quantity?: number;
            unitPrice?: number;
            updatedByUserId?: number;
            actorUserId?: number;
        },
    ) {
        const item = await this.prisma.item.findUnique({
            where: { id },
            include: {
                invoice: true,
            },
        });

        if (!item) {
            throw new NotFoundException('Article introuvable');
        }

        await this.getEditableInvoice(item.invoiceId);

        const actor = await this.getActor(data.actorUserId || data.updatedByUserId);

        const updateData: {
            name?: string;
            quantity?: number;
            unitPrice?: number;
            updatedByUserId: number;
        } = {
            updatedByUserId: actor.id,
        };

        if (data.name !== undefined) {
            updateData.name = data.name.trim() || 'Article';
        }

        if (data.quantity !== undefined) {
            updateData.quantity = Math.max(1, Number(data.quantity) || 1);
        }

        if (data.unitPrice !== undefined) {
            if (!this.canOverridePrice(actor.role)) {
                throw new ForbiddenException('Le serveur ne peut pas modifier le prix');
            }

            updateData.unitPrice = Math.max(0, Number(data.unitPrice) || 0);
        }

        const updated = await this.prisma.item.update({
            where: { id },
            data: updateData,
        });

        await this.prisma.activityLog.create({
            data: {
                action: 'UPDATE_ITEM',
                actorUserId: actor.id,
                invoiceId: item.invoiceId,
                itemId: item.id,
                details: `${actor.name} a modifié ${item.name}`,
            },
        });

        return updated;
    }

    async remove(id: number, actorUserId?: number) {
        const item = await this.prisma.item.findUnique({
            where: { id },
            include: {
                invoice: true,
            },
        });

        if (!item) {
            throw new NotFoundException('Article introuvable');
        }

        await this.getEditableInvoice(item.invoiceId);

        const actor = await this.getActor(actorUserId);

        await this.prisma.item.delete({
            where: { id },
        });

        await this.prisma.activityLog.create({
            data: {
                action: 'DELETE_ITEM',
                actorUserId: actor.id,
                invoiceId: item.invoiceId,
                itemId: item.id,
                details: `${actor.name} a supprimé ${item.name}`,
            },
        });

        return {
            success: true,
        };
    }

    private async getEditableInvoice(invoiceId: number) {
        const invoice = await this.prisma.invoice.findUnique({
            where: {
                id: invoiceId,
            },
        });

        if (!invoice) {
            throw new NotFoundException('Facture introuvable');
        }

        if (invoice.paymentValidated || invoice.status === 'PAID') {
            throw new BadRequestException('Facture réglée : modification bloquée');
        }

        return invoice;
    }

    private async getActor(actorUserId?: number) {
        if (!actorUserId) {
            throw new ForbiddenException('Utilisateur obligatoire');
        }

        const actor = await this.prisma.user.findUnique({
            where: {
                id: Number(actorUserId),
            },
        });

        if (!actor) {
            throw new ForbiddenException('Utilisateur introuvable');
        }

        if (!actor.active || actor.blocked) {
            throw new ForbiddenException('Utilisateur bloqué');
        }

        return actor;
    }

    private canOverridePrice(role: string) {
        return PRICE_MANAGERS.includes(role);
    }

    private async findMergeableItem(
        invoiceId: number,
        data: {
            productId: number | null;
            name: string;
            unitPrice: number;
        },
    ) {
        const items = await this.prisma.item.findMany({
            where: {
                invoiceId,
            },
        });

        return items.find((item) => {
            if (data.productId && item.productId) {
                return (
                    item.productId === data.productId &&
                    Number(item.unitPrice) === Number(data.unitPrice)
                );
            }

            return (
                !item.productId &&
                this.normalizeName(item.name) === this.normalizeName(data.name) &&
                Number(item.unitPrice) === Number(data.unitPrice)
            );
        });
    }

    private normalizeName(value: string) {
        return value.trim().toLocaleLowerCase();
    }
}
