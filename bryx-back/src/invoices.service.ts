import {
    BadRequestException,
    ForbiddenException,
    Injectable,
    NotFoundException,
} from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { RealtimeService } from './realtime.service';

@Injectable()
export class InvoicesService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly realtime: RealtimeService,
    ) { }

    findAll() {
        return this.prisma.invoice.findMany({
            orderBy: {
                createdAt: 'asc',
            },
            include: {
                table: true,
                responsibleUser: true,
                createdByUser: true,
                validatedByUser: true,
                customer: true,
                items: true,
                payments: true,
            },
        });
    }

    async findOne(id: number) {
        const invoice = await this.prisma.invoice.findUnique({
            where: { id },
            include: {
                table: true,
                responsibleUser: true,
                createdByUser: true,
                validatedByUser: true,
                customer: true,
                items: true,
                payments: true,
            },
        });

        if (!invoice) {
            throw new NotFoundException('Facture introuvable');
        }

        return invoice;
    }

    async create(data: {
        name?: string;
        tableId?: number;
        responsibleUserId?: number;
        createdByUserId?: number;
    }) {
        let tableId: number | null = data.tableId || null;
        let responsibleUserId: number | null = data.responsibleUserId || null;

        if (tableId) {
            const table = await this.prisma.table.findUnique({
                where: { id: tableId },
            });

            if (!table) {
                throw new NotFoundException('Table introuvable');
            }

            if (!responsibleUserId) {
                responsibleUserId = table.responsibleUserId;
            }
        }

        const invoice = await this.prisma.invoice.create({
            data: {
                name: data.name?.trim() || null,
                tableId,
                responsibleUserId,
                createdByUserId: data.createdByUserId || null,
                status: 'OPEN',
            },
        });

        await this.prisma.activityLog.create({
            data: {
                action: 'CREATE_INVOICE',
                actorUserId: data.createdByUserId || null,
                tableId,
                invoiceId: invoice.id,
                details: tableId
                    ? `Création facture sur table ${tableId}`
                    : 'Création facture volante',
            },
        });

        this.realtime.broadcast('invoice.created', {
            invoiceId: invoice.id,
            tableId,
            responsibleUserId,
        });

        return this.findOne(invoice.id);
    }

    async update(
        id: number,
        data: {
            name?: string;
            status?: string;
            actorUserId?: number;
        },
    ) {
        const invoice = await this.findOne(id);

        if (invoice.paymentValidated) {
            throw new BadRequestException('Facture clôturée : modification interdite');
        }

        if (data.status !== undefined && data.status !== 'CANCELLED') {
            throw new BadRequestException(
                'Le statut facture se modifie via une action métier dédiée',
            );
        }

        const updated = await this.prisma.invoice.update({
            where: { id },
            data: {
                ...(data.name !== undefined ? { name: data.name.trim() || null } : {}),
                ...(data.status !== undefined ? { status: data.status } : {}),
            },
        });

        await this.prisma.activityLog.create({
            data: {
                action: data.status === 'CANCELLED' ? 'CANCEL_INVOICE' : 'UPDATE_INVOICE',
                actorUserId: data.actorUserId || null,
                tableId: invoice.tableId,
                invoiceId: invoice.id,
                details:
                    data.status === 'CANCELLED'
                        ? `Facture ${invoice.id} annulée`
                        : `Modification facture ${invoice.id}`,
            },
        });

        this.realtime.broadcast('invoice.updated', {
            invoiceId: invoice.id,
            tableId: invoice.tableId,
            status: updated.status,
        });

        return this.findOne(updated.id);
    }

    async moveToTable(
        id: number,
        data: {
            tableId: number | null;
            actorUserId?: number;
            actorRole?: string;
        },
    ) {
        const invoice = await this.findOne(id);

        if (invoice.paymentValidated) {
            throw new BadRequestException('Facture clôturée : déplacement interdit');
        }

        let responsibleUserId = invoice.responsibleUserId;

        if (
            data.actorRole === 'SERVER' &&
            Number(invoice.responsibleUserId) !== Number(data.actorUserId)
        ) {
            throw new ForbiddenException(
                'Un serveur ne peut déplacer que ses propres factures',
            );
        }

        if (data.tableId) {
            const table = await this.prisma.table.findUnique({
                where: { id: data.tableId },
            });

            if (!table) {
                throw new NotFoundException('Table introuvable');
            }

            if (
                data.actorRole === 'SERVER' &&
                Number(table.responsibleUserId) !== Number(data.actorUserId)
            ) {
                throw new ForbiddenException(
                    'Un serveur ne peut déplacer une facture que vers ses tables',
                );
            }

            responsibleUserId = table.responsibleUserId;
        }

        const updated = await this.prisma.invoice.update({
            where: { id },
            data: {
                tableId: data.tableId,
                responsibleUserId,
            },
        });

        await this.prisma.activityLog.create({
            data: {
                action: 'MOVE_INVOICE',
                actorUserId: data.actorUserId || null,
                tableId: data.tableId || null,
                invoiceId: invoice.id,
                details: data.tableId
                    ? `Facture déplacée vers table ${data.tableId}`
                    : 'Facture rendue volante',
            },
        });

        this.realtime.broadcast('invoice.moved', {
            invoiceId: invoice.id,
            tableId: data.tableId || null,
            responsibleUserId,
        });

        return this.findOne(updated.id);
    }

    async moveToUser(
        id: number,
        data: {
            responsibleUserId: number;
            actorUserId?: number;
        },
    ) {
        const invoice = await this.findOne(id);

        if (invoice.paymentValidated) {
            throw new BadRequestException('Facture clôturée : déplacement interdit');
        }

        const user = await this.prisma.user.findUnique({
            where: { id: data.responsibleUserId },
        });

        if (!user) {
            throw new NotFoundException('Utilisateur introuvable');
        }

        const updated = await this.prisma.invoice.update({
            where: { id },
            data: {
                responsibleUserId: data.responsibleUserId,
            },
        });

        await this.prisma.activityLog.create({
            data: {
                action: 'MOVE_INVOICE',
                actorUserId: data.actorUserId || null,
                tableId: invoice.tableId,
                invoiceId: invoice.id,
                targetType: 'USER',
                targetId: user.id,
                details: `Facture déplacée vers ${user.name}`,
            },
        });

        this.realtime.broadcast('invoice.moved', {
            invoiceId: invoice.id,
            tableId: invoice.tableId,
            responsibleUserId: user.id,
        });

        return this.findOne(updated.id);
    }

    async requestPayment(id: number, data: { actorUserId?: number }) {
        const invoice = await this.findOne(id);

        if (invoice.paymentValidated) {
            throw new BadRequestException('Facture déjà clôturée');
        }

        const updated = await this.prisma.invoice.update({
            where: { id },
            data: {
                paymentRequested: true,
                paymentRequestedAt: new Date(),
                status: 'PAYMENT_REQUESTED',
            },
        });

        await this.prisma.activityLog.create({
            data: {
                action: 'REQUEST_PAYMENT',
                actorUserId: data.actorUserId || null,
                tableId: invoice.tableId,
                invoiceId: invoice.id,
                details: `Règlement demandé pour facture ${invoice.id}`,
            },
        });

        this.realtime.broadcast('payment.requested', {
            invoiceId: invoice.id,
            tableId: invoice.tableId,
        });

        return this.findOne(updated.id);
    }

    async updatePayment(
        id: number,
        data: {
            cashPaid?: number;
            cardPaid?: number;
            actorUserId?: number;
        },
    ) {
        const invoice = await this.findOne(id);

        if (invoice.paymentValidated) {
            throw new BadRequestException('Facture clôturée : règlement verrouillé');
        }

        const cashPaid =
            data.cashPaid !== undefined ? Number(data.cashPaid) : invoice.cashPaid;

        const cardPaid =
            data.cardPaid !== undefined ? Number(data.cardPaid) : invoice.cardPaid;

        if (cashPaid < 0 || cardPaid < 0) {
            throw new BadRequestException('Montant invalide');
        }

        const invoiceTotal = invoice.items.reduce((sum, item) => {
            return sum + item.quantity * item.unitPrice;
        }, 0);

        const paidTotal = cashPaid + cardPaid;

        const status =
            invoiceTotal > 0 && paidTotal >= invoiceTotal
                ? 'READY_TO_VALIDATE'
                : paidTotal > 0
                    ? 'PAYMENT_REQUESTED'
                    : 'OPEN';

        const updated = await this.prisma.invoice.update({
            where: { id },
            data: {
                cashPaid,
                cardPaid,
                status,
            },
        });

        await this.prisma.activityLog.create({
            data: {
                action: 'UPDATE_PAYMENT',
                actorUserId: data.actorUserId || null,
                tableId: invoice.tableId,
                invoiceId: invoice.id,
                details: `Règlement modifié : espèces ${cashPaid} €, CB ${cardPaid} €`,
            },
        });

        this.realtime.broadcast('payment.updated', {
            invoiceId: invoice.id,
            tableId: invoice.tableId,
            status: updated.status,
        });

        return this.findOne(updated.id);
    }

    async validatePaid(id: number, data: { actorUserId?: number }) {
        const invoice = await this.findOne(id);

        if (invoice.paymentValidated) {
            throw new BadRequestException('Facture déjà clôturée');
        }

        const invoiceTotal = invoice.items.reduce((sum, item) => {
            return sum + item.quantity * item.unitPrice;
        }, 0);

        const paidTotal = invoice.cashPaid + invoice.cardPaid;

        if (invoiceTotal <= 0) {
            throw new BadRequestException('Impossible de clôturer une facture vide');
        }

        if (paidTotal < invoiceTotal) {
            throw new BadRequestException('La facture n’est pas totalement réglée');
        }

        const updated = await this.prisma.invoice.update({
            where: { id },
            data: {
                paymentValidated: true,
                validatedByUserId: data.actorUserId || null,
                validatedAt: new Date(),
                status: 'PAID',
            },
        });

        await this.prisma.activityLog.create({
            data: {
                action: 'VALIDATE_PAYMENT',
                actorUserId: data.actorUserId || null,
                tableId: invoice.tableId,
                invoiceId: invoice.id,
                details: `Facture ${invoice.id} clôturée comme réglée`,
            },
        });

        if (invoice.tableId) {
            await this.closeTableIfEveryInvoiceIsPaid(
                invoice.tableId,
                data.actorUserId,
            );
        }

        this.realtime.broadcast('invoice.validated', {
            invoiceId: invoice.id,
            tableId: invoice.tableId,
            status: updated.status,
        });

        return this.findOne(updated.id);
    }

    private async closeTableIfEveryInvoiceIsPaid(
        tableId: number,
        actorUserId?: number,
    ) {
        const table = await this.prisma.table.findUnique({
            where: { id: tableId },
            include: {
                invoices: {
                    where: {
                        status: {
                            not: 'CANCELLED',
                        },
                    },
                },
            },
        });

        if (!table || table.status === 'CLOSED') return;
        if (!table.invoices.length) return;

        const everyInvoicePaid = table.invoices.every((tableInvoice) => {
            return (
                tableInvoice.status === 'PAID' ||
                tableInvoice.paymentValidated === true
            );
        });

        if (!everyInvoicePaid) return;

        await this.prisma.table.update({
            where: { id: tableId },
            data: {
                status: 'CLOSED',
            },
        });

        await this.prisma.activityLog.create({
            data: {
                action: 'UPDATE_TABLE',
                actorUserId: actorUserId || null,
                tableId,
                details: `Table ${table.name} fermee automatiquement : toutes les factures sont cloturees`,
            },
        });

        this.realtime.broadcast('table.closed', {
            tableId,
        });
    }
}
