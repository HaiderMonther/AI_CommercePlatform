import { TestContext, bearer, createTestApp, registerTenant, resetTenantData } from './helpers/test-app';

/**
 * Phase 4: orders — placement, the stock each lifecycle step books, payments, editing,
 * customer totals and tenant isolation.
 */
describe('Orders (e2e)', () => {
  let ctx: TestContext;
  let owner: Awaited<ReturnType<typeof registerTenant>>;
  let other: Awaited<ReturnType<typeof registerTenant>>;
  let viewerToken: string;

  let shirtId: string;
  let tshirtId: string;
  let blackMId: string;
  let serviceId: string;
  let customerId: string;

  const auth = () => bearer(owner.accessToken);

  async function stockOf(productId: string) {
    const response = await ctx
      .http()
      .get(`/api/v1/products/${productId}`)
      .set('Authorization', auth())
      .expect(200);
    return response.body.data as {
      stock: number;
      reservedStock: number;
      variants: { id: string; stock: number; reservedStock: number }[];
    };
  }

  async function placeOrder(body: Record<string, unknown>, status = 201) {
    return ctx.http().post('/api/v1/orders').set('Authorization', auth()).send(body).expect(status);
  }

  async function move(orderId: string, body: Record<string, unknown>, status = 200) {
    return ctx
      .http()
      .patch(`/api/v1/orders/${orderId}/status`)
      .set('Authorization', auth())
      .send(body)
      .expect(status);
  }

  async function customer(id: string) {
    const response = await ctx
      .http()
      .get(`/api/v1/customers/${id}`)
      .set('Authorization', auth())
      .expect(200);
    return response.body.data as {
      totalOrders: number;
      totalSpent: number;
      outstandingDebt: number;
      lastOrderAt: string | null;
    };
  }

  beforeAll(async () => {
    ctx = await createTestApp();
    await resetTenantData(ctx.prisma);

    owner = await registerTenant(ctx, { companyName: 'متجر الطلبات', email: 'owner@orders.iq' });
    other = await registerTenant(ctx, { companyName: 'متجر منافس', email: 'owner@rival.iq' });

    const http = ctx.http();

    shirtId = (
      await http
        .post('/api/v1/products')
        .set('Authorization', auth())
        .send({ name: 'قميص قطني', sku: 'SHIRT-1', price: 30000, salePrice: 25000, initialStock: 10 })
        .expect(201)
    ).body.data.id;

    tshirtId = (
      await http
        .post('/api/v1/products')
        .set('Authorization', auth())
        .send({ name: 'تيشيرت', sku: 'TEE-1', price: 15000 })
        .expect(201)
    ).body.data.id;

    blackMId = (
      await http
        .post(`/api/v1/products/${tshirtId}/variants`)
        .set('Authorization', auth())
        .send({ attributes: { color: 'أسود', size: 'M' }, initialStock: 3 })
        .expect(201)
    ).body.data.id;

    serviceId = (
      await http
        .post('/api/v1/products')
        .set('Authorization', auth())
        .send({ name: 'تغليف هدية', sku: 'GIFT-1', price: 2000, trackInventory: false })
        .expect(201)
    ).body.data.id;

    customerId = (
      await http
        .post('/api/v1/customers')
        .set('Authorization', auth())
        .send({ name: 'علي حسين', phone: '07701234567', city: 'بغداد', address: 'المنصور' })
        .expect(201)
    ).body.data.id;

    const roles = (await http.get('/api/v1/roles').set('Authorization', auth()).expect(200)).body
      .data as { id: string; key: string }[];

    await http
      .post('/api/v1/users')
      .set('Authorization', auth())
      .send({
        email: 'viewer@orders.iq',
        fullName: 'مشاهد',
        password: 'Member@12345',
        roleId: roles.find((role) => role.key === 'VIEWER')!.id,
      })
      .expect(201);

    viewerToken = (
      await http
        .post('/api/v1/auth/login')
        .send({ email: 'viewer@orders.iq', password: 'Member@12345' })
        .expect(200)
    ).body.data.tokens.accessToken;
  });

  afterAll(async () => {
    await resetTenantData(ctx.prisma);
    await ctx.app.close();
  });

  describe('Placement', () => {
    let orderId: string;

    it('places an order at catalog prices and reserves its stock', async () => {
      const response = await placeOrder({
        customerId,
        items: [
          { productId: shirtId, quantity: 2 },
          { productId: tshirtId, variantId: blackMId, quantity: 1 },
          { productId: serviceId, quantity: 1 },
        ],
        deliveryFee: 5000,
      });

      const order = response.body.data;
      orderId = order.id;

      expect(order.orderNumber).toBe(1001);
      expect(order.status).toBe('NEW');
      expect(order.paymentStatus).toBe('UNPAID');
      expect(order.source).toBe('DASHBOARD');
      // 2 × 25000 (sale price) + 15000 + 2000
      expect(order.subtotal).toBe(67000);
      expect(order.total).toBe(72000);
      expect(order.customerPhone).toBe('+9647701234567');
      expect(order.deliveryCity).toBe('بغداد');
      expect(order.deliveryAddress).toBe('المنصور');
      expect(order.items).toHaveLength(3);
      expect(order.items.map((item: { variantName: string | null }) => item.variantName)).toContain(
        'أسود / M',
      );
      expect(order.allowedTransitions).toContain('CONFIRMED');
      expect(order.statusHistory).toHaveLength(1);

      const shirt = await stockOf(shirtId);
      expect(shirt.stock).toBe(10);
      expect(shirt.reservedStock).toBe(2);

      const tee = await stockOf(tshirtId);
      expect(tee.variants[0].reservedStock).toBe(1);
      expect(tee.reservedStock).toBe(1);
    });

    it('numbers orders sequentially per company', async () => {
      const second = await placeOrder({ customerId, items: [{ productId: serviceId, quantity: 1 }] });
      expect(second.body.data.orderNumber).toBe(1002);

      await ctx.prisma.customer.create({
        data: { companyId: other.companyId, name: 'زبون آخر', phone: '+9647801111111' },
      });
      const otherCustomer = await ctx.prisma.customer.findFirstOrThrow({
        where: { companyId: other.companyId },
      });
      const otherProduct = await ctx
        .http()
        .post('/api/v1/products')
        .set('Authorization', bearer(other.accessToken))
        .send({ name: 'منتج', price: 1000, trackInventory: false })
        .expect(201);

      const rival = await ctx
        .http()
        .post('/api/v1/orders')
        .set('Authorization', bearer(other.accessToken))
        .send({ customerId: otherCustomer.id, items: [{ productId: otherProduct.body.data.id, quantity: 1 }] })
        .expect(201);

      expect(rival.body.data.orderNumber).toBe(1001);

      // Leave the extra order out of the stock and totals assertions below.
      await move(second.body.data.id, { status: 'CANCELLED', cancelReason: 'تجربة' });
    });

    it('refuses an order that exceeds available stock and writes nothing', async () => {
      const before = await ctx.prisma.order.count({ where: { companyId: owner.companyId } });

      const response = await placeOrder(
        {
          customer: { name: 'زبون جديد', phone: '07809998877' },
          items: [
            { productId: serviceId, quantity: 1 },
            { productId: shirtId, quantity: 9 }, // 10 on hand, 2 reserved
          ],
        },
        409,
      );

      expect(response.body.code).toBe('INSUFFICIENT_STOCK');
      expect(response.body.message).toContain('قميص قطني');
      expect(await ctx.prisma.order.count({ where: { companyId: owner.companyId } })).toBe(before);
      expect(
        await ctx.prisma.customer.count({ where: { phone: '+9647809998877' } }),
      ).toBe(0);
      expect((await stockOf(shirtId)).reservedStock).toBe(2);
    });

    it('requires a variant for a product that has variants', async () => {
      await placeOrder({ customerId, items: [{ productId: tshirtId, quantity: 1 }] }, 400);
    });

    it('creates the customer on the fly, or reuses one with the same phone', async () => {
      const created = await placeOrder({
        customer: { name: 'زينب', phone: '0780 555 1234', city: 'البصرة' },
        items: [{ productId: serviceId, quantity: 1 }],
      });
      expect(created.body.data.customer.name).toBe('زينب');
      expect(created.body.data.deliveryCity).toBe('البصرة');

      const reused = await placeOrder({
        customer: { name: 'اسم مختلف', phone: '٠٧٨٠٥٥٥١٢٣٤' },
        items: [{ productId: serviceId, quantity: 1 }],
      });
      expect(reused.body.data.customer.id).toBe(created.body.data.customer.id);
    });

    it('rejects a conversation that belongs to another customer', async () => {
      const otherCustomer = await ctx.prisma.customer.create({
        data: { companyId: owner.companyId, name: 'غريب', phone: '+9647712223333' },
      });
      const conversation = await ctx.prisma.conversation.create({
        data: { companyId: owner.companyId, customerId: otherCustomer.id, channel: 'WHATSAPP' },
      });

      await placeOrder(
        {
          customerId,
          conversationId: conversation.id,
          items: [{ productId: serviceId, quantity: 1 }],
        },
        400,
      );
    });

    it('refuses an order for a blocked customer', async () => {
      const blocked = await ctx.prisma.customer.create({
        data: { companyId: owner.companyId, name: 'محظور', phone: '+9647714445555', status: 'BLOCKED' },
      });

      const response = await placeOrder(
        { customerId: blocked.id, items: [{ productId: serviceId, quantity: 1 }] },
        400,
      );
      expect(response.body.code).toBe('CUSTOMER_BLOCKED');
    });

    describe('Lifecycle', () => {
      it('rejects moving backwards', async () => {
        await move(orderId, { status: 'CONFIRMED' });
        const response = await move(orderId, { status: 'NEW' }, 409);
        expect(response.body.code).toBe('ORDER_INVALID_TRANSITION');
      });

      it('requires a reason to cancel', async () => {
        await move(orderId, { status: 'CANCELLED' }, 400);
      });

      it('locks the lines once preparation starts', async () => {
        await move(orderId, { status: 'PREPARING', note: 'بدأ التغليف' });

        const response = await ctx
          .http()
          .put(`/api/v1/orders/${orderId}/items`)
          .set('Authorization', auth())
          .send({ items: [{ productId: serviceId, quantity: 1 }] })
          .expect(409);
        expect(response.body.code).toBe('ORDER_NOT_EDITABLE');
      });

      it('turns the reservation into a sale when shipped', async () => {
        const response = await move(orderId, { status: 'SHIPPED' });
        expect(response.body.data.deliveryStatus).toBe('IN_TRANSIT');

        const shirt = await stockOf(shirtId);
        expect(shirt.stock).toBe(8);
        expect(shirt.reservedStock).toBe(0);

        const movements = await ctx
          .http()
          .get('/api/v1/inventory/movements')
          .query({ productId: shirtId })
          .set('Authorization', auth())
          .expect(200);
        const types = movements.body.data.items.map((m: { type: string }) => m.type);
        expect(types).toEqual(expect.arrayContaining(['RESERVATION', 'RELEASE', 'SALE']));
      });

      it('counts the order towards the customer once delivered, with the unpaid balance as debt', async () => {
        const response = await move(orderId, { status: 'DELIVERED' });
        expect(response.body.data.deliveredAt).not.toBeNull();
        expect(response.body.data.allowedTransitions).toEqual([]);
        expect(response.body.data.statusHistory.map((h: { toStatus: string }) => h.toStatus)).toEqual([
          'NEW',
          'CONFIRMED',
          'PREPARING',
          'SHIPPED',
          'DELIVERED',
        ]);

        const stats = await customer(customerId);
        expect(stats.totalOrders).toBe(1);
        expect(stats.totalSpent).toBe(72000);
        expect(stats.outstandingDebt).toBe(72000);
        expect(stats.lastOrderAt).not.toBeNull();
      });

      it('records payments and clears the debt', async () => {
        await ctx
          .http()
          .patch(`/api/v1/orders/${orderId}/payment`)
          .set('Authorization', auth())
          .send({ paidAmount: 80000 })
          .expect(400);

        const partial = await ctx
          .http()
          .patch(`/api/v1/orders/${orderId}/payment`)
          .set('Authorization', auth())
          .send({ paidAmount: 40000 })
          .expect(200);
        expect(partial.body.data.paymentStatus).toBe('PARTIALLY_PAID');
        expect(partial.body.data.balanceDue).toBe(32000);
        expect((await customer(customerId)).outstandingDebt).toBe(32000);

        const paid = await ctx
          .http()
          .patch(`/api/v1/orders/${orderId}/payment`)
          .set('Authorization', auth())
          .send({ paidAmount: 72000 })
          .expect(200);
        expect(paid.body.data.paymentStatus).toBe('PAID');
        expect((await customer(customerId)).outstandingDebt).toBe(0);
      });

      it('treats a delivered order as final', async () => {
        await move(orderId, { status: 'CANCELLED', cancelReason: 'متأخر' }, 409);
      });
    });
  });

  describe('Cancellation', () => {
    it('releases the reservation of an unshipped order', async () => {
      const order = await placeOrder({ customerId, items: [{ productId: shirtId, quantity: 3 }] });
      expect((await stockOf(shirtId)).reservedStock).toBe(3);

      const cancelled = await move(order.body.data.id, {
        status: 'CANCELLED',
        cancelReason: 'الزبون غيّر رأيه',
      });
      expect(cancelled.body.data.cancelReason).toBe('الزبون غيّر رأيه');

      const shirt = await stockOf(shirtId);
      expect(shirt.reservedStock).toBe(0);
      expect(shirt.stock).toBe(8);
    });

    it('books the goods back in when a shipped order is refused', async () => {
      const order = await placeOrder({
        customerId,
        items: [{ productId: tshirtId, variantId: blackMId, quantity: 2 }],
      });
      // 3 opening units, one already sold with order #1001.
      await move(order.body.data.id, { status: 'SHIPPED' });
      expect((await stockOf(tshirtId)).variants[0].stock).toBe(0);

      const refused = await move(order.body.data.id, {
        status: 'CANCELLED',
        cancelReason: 'رفض الاستلام',
      });
      expect(refused.body.data.deliveryStatus).toBe('RETURNED');

      const variant = (await stockOf(tshirtId)).variants[0];
      expect(variant.stock).toBe(2);
      expect(variant.reservedStock).toBe(0);
    });

    it('releases stock once when two cancellations race', async () => {
      const order = await placeOrder({ customerId, items: [{ productId: shirtId, quantity: 2 }] });
      const id = order.body.data.id;

      const results = await Promise.all([
        ctx
          .http()
          .patch(`/api/v1/orders/${id}/status`)
          .set('Authorization', auth())
          .send({ status: 'CANCELLED', cancelReason: 'أول' }),
        ctx
          .http()
          .patch(`/api/v1/orders/${id}/status`)
          .set('Authorization', auth())
          .send({ status: 'CANCELLED', cancelReason: 'ثاني' }),
      ]);

      expect(results.map((r) => r.status).sort()).toEqual([200, 400]);
      expect((await stockOf(shirtId)).reservedStock).toBe(0);
    });

    it('only deletes cancelled orders', async () => {
      const order = await placeOrder({ customerId, items: [{ productId: serviceId, quantity: 1 }] });
      const id = order.body.data.id;

      await ctx.http().delete(`/api/v1/orders/${id}`).set('Authorization', auth()).expect(409);
      await move(id, { status: 'CANCELLED', cancelReason: 'مكرر' });
      await ctx.http().delete(`/api/v1/orders/${id}`).set('Authorization', auth()).expect(200);
      await ctx.http().get(`/api/v1/orders/${id}`).set('Authorization', auth()).expect(404);
    });
  });

  describe('Editing', () => {
    let orderId: string;

    beforeAll(async () => {
      orderId = (
        await placeOrder({ customerId, items: [{ productId: shirtId, quantity: 1 }] })
      ).body.data.id;
    });

    it('replaces lines and reserves only the difference', async () => {
      const response = await ctx
        .http()
        .put(`/api/v1/orders/${orderId}/items`)
        .set('Authorization', auth())
        .send({
          items: [
            { productId: shirtId, quantity: 3, unitPrice: 20000 },
            { productId: serviceId, quantity: 1 },
          ],
        })
        .expect(200);

      expect(response.body.data.items).toHaveLength(2);
      expect(response.body.data.subtotal).toBe(62000);
      expect((await stockOf(shirtId)).reservedStock).toBe(3);
    });

    it('updates discount and delivery fee and recomputes the total', async () => {
      const response = await ctx
        .http()
        .patch(`/api/v1/orders/${orderId}`)
        .set('Authorization', auth())
        .send({ discount: 2000, deliveryFee: 5000, deliveryCity: 'أربيل' })
        .expect(200);

      expect(response.body.data.total).toBe(65000);
      expect(response.body.data.deliveryCity).toBe('أربيل');
    });

    it('refuses a discount larger than the products', async () => {
      await ctx
        .http()
        .patch(`/api/v1/orders/${orderId}`)
        .set('Authorization', auth())
        .send({ discount: 100000 })
        .expect(400);
    });

    it('does not let an operator set a delivery state that follows the order status', async () => {
      await ctx
        .http()
        .patch(`/api/v1/orders/${orderId}`)
        .set('Authorization', auth())
        .send({ deliveryStatus: 'DELIVERED' })
        .expect(400);

      const assigned = await ctx
        .http()
        .patch(`/api/v1/orders/${orderId}`)
        .set('Authorization', auth())
        .send({ deliveryStatus: 'ASSIGNED' })
        .expect(200);
      expect(assigned.body.data.deliveryStatus).toBe('ASSIGNED');
    });
  });

  describe('Listing', () => {
    it('filters by status and finds an order by its number', async () => {
      const delivered = await ctx
        .http()
        .get('/api/v1/orders')
        .query({ status: 'DELIVERED' })
        .set('Authorization', auth())
        .expect(200);
      expect(delivered.body.data.items.map((o: { orderNumber: number }) => o.orderNumber)).toEqual([
        1001,
      ]);

      const byNumber = await ctx
        .http()
        .get('/api/v1/orders')
        .query({ search: '#1001' })
        .set('Authorization', auth())
        .expect(200);
      expect(byNumber.body.data.items).toHaveLength(1);

      const byPhone = await ctx
        .http()
        .get('/api/v1/orders')
        .query({ search: '0770123', customerId })
        .set('Authorization', auth())
        .expect(200);
      expect(byPhone.body.data.items.length).toBeGreaterThan(0);
    });

    it('counts orders per status', async () => {
      const response = await ctx
        .http()
        .get('/api/v1/orders/stats')
        .set('Authorization', auth())
        .expect(200);

      expect(response.body.data.byStatus.DELIVERED).toBe(1);
      expect(response.body.data.open).toBeGreaterThan(0);
    });
  });

  describe('Access', () => {
    it('lets a viewer read but not place orders', async () => {
      await ctx.http().get('/api/v1/orders').set('Authorization', bearer(viewerToken)).expect(200);
      await ctx
        .http()
        .post('/api/v1/orders')
        .set('Authorization', bearer(viewerToken))
        .send({ customerId, items: [{ productId: serviceId, quantity: 1 }] })
        .expect(403);
    });

    it("hides another company's orders and products", async () => {
      const mine = await ctx.prisma.order.findFirstOrThrow({ where: { companyId: owner.companyId } });

      await ctx
        .http()
        .get(`/api/v1/orders/${mine.id}`)
        .set('Authorization', bearer(other.accessToken))
        .expect(404);

      await ctx
        .http()
        .patch(`/api/v1/orders/${mine.id}/status`)
        .set('Authorization', bearer(other.accessToken))
        .send({ status: 'CONFIRMED' })
        .expect(404);

      const otherCustomer = await ctx.prisma.customer.findFirstOrThrow({
        where: { companyId: other.companyId },
      });
      await ctx
        .http()
        .post('/api/v1/orders')
        .set('Authorization', bearer(other.accessToken))
        .send({ customerId: otherCustomer.id, items: [{ productId: shirtId, quantity: 1 }] })
        .expect(404);
    });
  });
});
