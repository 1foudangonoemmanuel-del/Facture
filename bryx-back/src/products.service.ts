import {
    BadRequestException,
    ForbiddenException,
    Injectable,
    NotFoundException,
} from '@nestjs/common';
import { PrismaService } from './prisma.service';

const CATALOG_MANAGERS = ['ADMIN', 'MANAGER'];

@Injectable()
export class ProductsService {
    constructor(private readonly prisma: PrismaService) { }

    findAll() {
        return this.prisma.product.findMany({
            where: {
                active: true,
            },
            orderBy: {
                name: 'asc',
            },
        });
    }

    async create(data: {
        name: string;
        price: number;
        category?: string;
        actorUserId?: number;
    }) {
        const actor = await this.assertCanManageCatalog(data.actorUserId);

        const name = data.name?.trim();
        const price = Number(data.price);

        if (!name) {
            throw new BadRequestException('Nom produit obligatoire');
        }

        if (Number.isNaN(price) || price < 0) {
            throw new BadRequestException('Prix invalide');
        }

        const product = await this.prisma.product.create({
            data: {
                name,
                price,
                category: data.category?.trim() || null,
            },
        });

        await this.prisma.activityLog.create({
            data: {
                action: 'CREATE_PRODUCT',
                actorUserId: actor.id,
                targetType: 'PRODUCT',
                targetId: product.id,
                details: `${actor.name} a créé le produit ${product.name} à ${product.price} €`,
            },
        });

        return product;
    }

    async update(
        id: number,
        data: {
            name?: string;
            price?: number;
            category?: string | null;
            active?: boolean;
            actorUserId?: number;
        },
    ) {
        const actor = await this.assertCanManageCatalog(data.actorUserId);

        const product = await this.prisma.product.findUnique({
            where: { id },
        });

        if (!product) {
            throw new NotFoundException('Produit introuvable');
        }

        const updateData: {
            name?: string;
            price?: number;
            category?: string | null;
            active?: boolean;
        } = {};

        if (data.name !== undefined) {
            const name = data.name.trim();

            if (!name) {
                throw new BadRequestException('Nom produit obligatoire');
            }

            updateData.name = name;
        }

        if (data.price !== undefined) {
            const price = Number(data.price);

            if (Number.isNaN(price) || price < 0) {
                throw new BadRequestException('Prix invalide');
            }

            updateData.price = price;
        }

        if (data.category !== undefined) {
            updateData.category = data.category?.trim() || null;
        }

        if (data.active !== undefined) {
            updateData.active = Boolean(data.active);
        }

        const updated = await this.prisma.product.update({
            where: { id },
            data: updateData,
        });

        await this.prisma.activityLog.create({
            data: {
                action: 'UPDATE_PRODUCT',
                actorUserId: actor.id,
                targetType: 'PRODUCT',
                targetId: product.id,
                details: `${actor.name} a modifié le produit ${product.name}`,
            },
        });

        return updated;
    }

    async disable(id: number, actorUserId?: number) {
        const actor = await this.assertCanManageCatalog(actorUserId);

        const product = await this.prisma.product.findUnique({
            where: { id },
        });

        if (!product) {
            throw new NotFoundException('Produit introuvable');
        }

        const disabled = await this.prisma.product.update({
            where: { id },
            data: {
                active: false,
            },
        });

        await this.prisma.activityLog.create({
            data: {
                action: 'DISABLE_PRODUCT',
                actorUserId: actor.id,
                targetType: 'PRODUCT',
                targetId: product.id,
                details: `${actor.name} a désactivé le produit ${product.name}`,
            },
        });

        return disabled;
    }

    private async assertCanManageCatalog(actorUserId?: number) {
        if (!actorUserId) {
            throw new ForbiddenException('Utilisateur obligatoire');
        }

        const user = await this.prisma.user.findUnique({
            where: {
                id: Number(actorUserId),
            },
        });

        if (!user) {
            throw new ForbiddenException('Utilisateur introuvable');
        }

        if (!user.active || user.blocked) {
            throw new ForbiddenException('Utilisateur bloqué');
        }

        if (!CATALOG_MANAGERS.includes(user.role)) {
            throw new ForbiddenException(
                'Seul admin ou manager peut modifier le catalogue',
            );
        }

        return user;
    }
}