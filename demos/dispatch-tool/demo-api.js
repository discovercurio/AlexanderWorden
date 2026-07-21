(() => {
  'use strict';

  const nativeFetch = window.fetch.bind(window);
  const DATA_URL = './data/demo-data.json';
  let baseData = null;
  let state = null;
  let refreshStep = 0;

  const deepClone = value => JSON.parse(JSON.stringify(value));
  const round2 = value => Math.round((Number(value) + Number.EPSILON) * 100) / 100;
  const isoFromOffset = minutes => new Date(Date.now() + Number(minutes || 0) * 60000).toISOString();

  function materializeDriver(feature) {
    const f = deepClone(feature);
    const p = f.properties || (f.properties = {});
    if (p.LastSeenOffsetMinutes !== undefined) {
      p.Last_Seen_Online = isoFromOffset(p.LastSeenOffsetMinutes);
      delete p.LastSeenOffsetMinutes;
    }
    if (p.LastLocationOffsetMinutes !== undefined) {
      p.LastLocationDate = isoFromOffset(p.LastLocationOffsetMinutes);
      p.LastLocationDateTime = p.LastLocationDate;
      delete p.LastLocationOffsetMinutes;
    }
    return f;
  }

  function materializeOrder(order) {
    const o = deepClone(order);
    o.delWindowStart = isoFromOffset(o.windowStartOffsetMinutes);
    o.delWindowEnd = isoFromOffset(o.windowEndOffsetMinutes);
    delete o.windowStartOffsetMinutes;
    delete o.windowEndOffsetMinutes;
    if (o.pickup?.scheduledOffsetMinutes !== undefined) {
      o.pickup.scheduledAt = isoFromOffset(o.pickup.scheduledOffsetMinutes);
      delete o.pickup.scheduledOffsetMinutes;
    }
    if (o.dropoff?.scheduledOffsetMinutes !== undefined) {
      o.dropoff.scheduledAt = isoFromOffset(o.dropoff.scheduledOffsetMinutes);
      delete o.dropoff.scheduledOffsetMinutes;
    }
    return o;
  }

  function materializeAlert(alert) {
    const a = deepClone(alert);
    a.eventDateTime = isoFromOffset(a.eventOffsetMinutes);
    delete a.eventOffsetMinutes;
    return a;
  }

  function buildState() {
    state = {
      user: deepClone(baseData.user),
      regions: deepClone(baseData.regions),
      areas: deepClone(baseData.areas),
      zones: deepClone(baseData.zones),
      drivers: {
        type: 'FeatureCollection',
        features: baseData.drivers.features.map(materializeDriver)
      },
      orders: baseData.orders.map(materializeOrder),
      pickupDelayAlerts: baseData.pickupDelayAlerts.map(materializeAlert),
      messages: []
    };
    refreshStep = 0;
  }

  function findOrder({ orderId, jobId }) {
    return state.orders.find(o =>
      (orderId && String(o.orderId) === String(orderId)) ||
      (jobId && String(o.jobId) === String(jobId))
    );
  }

  function findDriver(driverId) {
    return state.drivers.features.find(f => String(f.properties?.DriverId) === String(driverId));
  }

  function response(payload, status = 200) {
    return new Response(JSON.stringify(payload), {
      status,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
    });
  }

  function parseBody(init) {
    if (!init?.body) return {};
    if (typeof init.body === 'string') {
      try { return JSON.parse(init.body); } catch { return {}; }
    }
    return init.body || {};
  }

  function statsSummary() {
    const counts = { total: 0, unassigned: 0, inProgress: 0, scheduled: 0, completed: 0 };
    const money = { orderCost: 0, driverPay: 0, otherFee: 0 };
    for (const o of state.orders) {
      counts.total++;
      const s = String(o.orderStatus || '').toLowerCase();
      if (s === 'new') counts.unassigned++;
      else if (s === 'confirmed' || s.includes('out for delivery')) counts.inProgress++;
      else if (s === 'scheduled') counts.scheduled++;
      else if (s === 'delivered') counts.completed++;
      money.orderCost += Number(o.orderCost || 0);
      money.driverPay += Number(o.driverTotalPay || 0);
      money.otherFee += Number(o.driverPayBreakdown?.otherFee || 0);
    }
    Object.keys(money).forEach(k => money[k] = round2(money[k]));
    return { counts, money, refreshedAt: new Date().toISOString() };
  }

  function orderModeResult(url) {
    const mode = String(url.searchParams.get('mode') || 'unassigned').toLowerCase();
    const orderId = String(url.searchParams.get('orderId') || '').trim();
    const regionId = String(url.searchParams.get('regionId') || '').trim();
    const inRegion = o => !regionId || regionId === '58' || String(o.regionId || '') === regionId;

    if (mode === 'stats') {
      return response({ status: true, mode: 'stats', stats: statsSummary(), windowStart: new Date().toISOString(), windowEnd: isoFromOffset(720) });
    }

    if (orderId) {
      const found = state.orders.filter(o => String(o.orderId) === orderId && inRegion(o));
      return response({
        status: true,
        mode: 'search',
        orderId,
        orders: deepClone(found),
        scheduledOrders: [],
        totalFound: found.length,
        totalInsideWindow: found.length,
        windowStart: isoFromOffset(-1440),
        windowEnd: isoFromOffset(1440)
      });
    }

    let orders = [];
    if (mode === 'unassigned') orders = state.orders.filter(o => String(o.orderStatus).toLowerCase() === 'new');
    else if (mode === 'in-progress') orders = state.orders.filter(o => ['confirmed', 'out for delivery'].includes(String(o.orderStatus).toLowerCase()));
    else if (mode === 'scheduled') orders = state.orders.filter(o => String(o.orderStatus).toLowerCase() === 'scheduled');
    else if (mode === 'completed') orders = state.orders.filter(o => String(o.orderStatus).toLowerCase() === 'delivered');

    orders = orders.filter(inRegion);
    const scheduledOrders = mode === 'unassigned'
      ? state.orders.filter(o => String(o.orderStatus).toLowerCase() === 'scheduled').filter(inRegion)
      : [];

    return response({
      status: true,
      mode,
      orders: deepClone(orders),
      scheduledOrders: deepClone(scheduledOrders),
      windowStart: new Date().toISOString(),
      windowEnd: isoFromOffset(mode === 'scheduled' ? 1440 : 720)
    });
  }

  function driverResult(url) {
    const regionId = String(url.searchParams.get('regionId') || '').trim();
    const features = state.drivers.features.filter(f => !regionId || regionId === '58' || String(f.properties?.RegionId) === regionId);
    return response({ type: 'FeatureCollection', features: deepClone(features) });
  }

  function orderDetailsResult(url) {
    const order = findOrder({ orderId: url.searchParams.get('orderId'), jobId: url.searchParams.get('jobId') });
    if (!order) return response({ status: false, stale: true, reason: 'stale_current_order', error: 'Order not found in demo data' });
    return response({ status: true, order: deepClone(order) });
  }

  function orderEventsResult(url) {
    const details = url.searchParams.get('details') === '1' || url.searchParams.get('mode') === 'details';
    const ids = String(url.searchParams.get('orderIds') || url.searchParams.get('orderId') || '')
      .split(',').map(v => v.trim()).filter(Boolean);
    const matching = state.pickupDelayAlerts.filter(a => ids.includes(String(a.orderId)));
    if (details && ids.length === 1) {
      return response({ status: true, orderId: ids[0], events: [], alert: matching[0] || null, unavailable: true, message: 'Not Available in the Demo' });
    }
    return response({
      status: true,
      checked: ids.length,
      alerts: deepClone(matching),
      results: ids.map(id => ({ orderId: id, alert: matching.find(a => String(a.orderId) === id) || null, checked: true }))
    });
  }

  function assignOrder(init) {
    const body = parseBody(init);
    const order = findOrder({ orderId: body.orderId, jobId: body.jobId });
    const driverFeature = findDriver(body.driverId);
    if (!order || !driverFeature) return response({ error: 'Missing demo order or driver.' }, 400);

    const p = driverFeature.properties;
    order.orderStatus = 'Confirmed';
    order.driverId = String(p.DriverId);
    order.driverName = p.Driver_Name;
    order.carrierDriverName = p.Driver_Name;
    order.lastEvent = 'Driver Assigned';
    p.Is_Online = true;
    p.In_Job = true;
    p.Driver_Status = 'On Job';
    p.OrderId = String(order.orderId);
    p.JobId = String(order.jobId);
    p.DeliveryId = String(order.carrierDeliveryId || `DEL-${order.jobId}`);
    p.Last_Seen_Online = new Date().toISOString();
    return response({
      status: true,
      message: `${p.Driver_Name} assigned to Order ${order.orderId}.`,
      updatedOrder: deepClone(order),
      updatedDriverId: p.DriverId
    });
  }

  function updateFee(init) {
    const body = parseBody(init);
    const order = findOrder({ jobId: body.jobId });
    if (!order) return response({ error: 'Order not found in demo data.' }, 404);
    const desired = Number(body.desiredOtherFee);
    if (!Number.isFinite(desired) || desired < 0) return response({ error: 'Invalid Other Fee value.' }, 400);
    const oldFee = Number(order.driverPayBreakdown?.otherFee || 0);
    const delta = round2(desired - oldFee);
    order.driverPayBreakdown = order.driverPayBreakdown || {};
    order.driverPayBreakdown.otherFee = round2(desired);
    order.driverTotalPay = round2(Number(order.driverTotalPay || 0) + delta);
    return response({
      status: true,
      message: `Added ${formatMoney(delta)} to Other Fee.`,
      previousOtherFee: oldFee,
      newOtherFee: order.driverPayBreakdown.otherFee,
      expectedNewTotal: order.driverTotalPay,
      paymentDetails: {
        total: order.driverTotalPay,
        otherFee: order.driverPayBreakdown.otherFee,
        totalMiles: order.driverPayBreakdown.totalMiles,
        mileageFee: order.driverPayBreakdown.mileageFee,
        totalTip: order.driverPayBreakdown.totalTip,
        postTips: null,
        cancellationFee: null,
        currencySymbol: '$'
      }
    });
  }

  function formatMoney(value) {
    const n = Number(value || 0);
    return `$${n.toFixed(2)}`;
  }

  function zoneMessageResult(url, init) {
    if ((init?.method || 'GET').toUpperCase() === 'POST') {
      const body = parseBody(init);
      const zoneId = String(body.zoneId || '');
      const eligible = state.drivers.features.filter(f => String(f.properties?.ZoneId) === zoneId);
      state.messages.push({ ...body, sentAt: new Date().toISOString(), recipientCount: eligible.length });
      return response({
        status: true,
        recipientCount: eligible.length,
        results: {
          sms: { status: 200, ok: true, response: { recipientCount: eligible.length } },
          notification: { status: 200, ok: true, response: { recipientCount: eligible.length } }
        }
      });
    }

    const action = String(url.searchParams.get('action') || '').toLowerCase();
    if (action === 'areas') {
      const regionId = Number(url.searchParams.get('regionId') || 58);
      return response({ status: true, action, regionId, areas: deepClone(state.areas.filter(a => Number(a.RegionId) === regionId)) });
    }
    if (action === 'zones') {
      const areaId = Number(url.searchParams.get('areaId') || 163);
      return response({ status: true, action, areaId, zones: deepClone(state.zones.filter(z => Number(z.AreaId) === areaId)) });
    }
    if (action === 'resolve-zone') {
      const zoneId = Number(url.searchParams.get('zoneId'));
      const zone = state.zones.find(z => Number(z.ZoneId) === zoneId) || state.zones[0];
      return response({
        status: true,
        action,
        regionId: zone.RegionId,
        areaId: zone.AreaId,
        areaName: zone.AreaName,
        zoneId: zone.ZoneId,
        zoneName: zone.ZoneName
      });
    }
    return response({ error: 'Invalid demo action' }, 400);
  }

  async function handle(input, init = {}) {
    await api.ready;
    const raw = typeof input === 'string' ? input : input?.url || '';
    const url = new URL(raw, window.location.origin);
    const path = url.pathname;
    if (path === '/demo-api/drivers') return driverResult(url);
    if (path === '/demo-api/orders') return orderModeResult(url);
    if (path === '/demo-api/order-details') return orderDetailsResult(url);
    if (path === '/demo-api/order-events') return orderEventsResult(url);
    if (path === '/demo-api/assign-order') return assignOrder(init);
    if (path === '/demo-api/update-order-fee') return updateFee(init);
    if (path === '/demo-api/zone-messages') return zoneMessageResult(url, init);
    if (path === '/demo-api/health') return response({ status: true, mode: 'demo' });
    return nativeFetch(input, init);
  }

  const api = {
    ready: nativeFetch(DATA_URL, { cache: 'no-store' })
      .then(r => {
        if (!r.ok) throw new Error(`Could not load demo data (${r.status})`);
        return r.json();
      })
      .then(data => { baseData = data; buildState(); return true; }),
    async reset() { await api.ready; buildState(); },
    async resetDrivers() {
      await api.ready;
      state.drivers = { type: 'FeatureCollection', features: baseData.drivers.features.map(materializeDriver) };
      // Re-apply current assignments from the mutable order state.
      for (const order of state.orders) {
        if (!order.driverId || !['confirmed','out for delivery'].includes(String(order.orderStatus).toLowerCase())) continue;
        const d = findDriver(order.driverId);
        if (!d) continue;
        Object.assign(d.properties, { Is_Online: true, In_Job: true, Driver_Status: 'On Job', OrderId: order.orderId, JobId: order.jobId, DeliveryId: order.carrierDeliveryId || '' });
      }
    },
    async simulateDriverRefresh() {
      await api.ready;
      refreshStep++;
      for (let i = 0; i < state.drivers.features.length; i++) {
        const f = state.drivers.features[i];
        const p = f.properties || {};
        if (!p.Is_Online && !p.In_Job) continue;
        const angle = (i * 37 + refreshStep * 19) * Math.PI / 180;
        const distance = 0.0008 + ((i + refreshStep) % 4) * 0.00025;
        f.geometry.coordinates[0] += Math.cos(angle) * distance;
        f.geometry.coordinates[1] += Math.sin(angle) * distance;
        p.Last_Seen_Online = new Date().toISOString();
        p.LastLocationDate = p.Last_Seen_Online;
        p.LastLocationDateTime = p.Last_Seen_Online;
      }
    },
    getSnapshot() { return deepClone(state); },
    handle
  };

  window.DemoAPI = api;
  window.fetch = function demoAwareFetch(input, init) {
    const raw = typeof input === 'string' ? input : input?.url || '';
    const url = new URL(raw, window.location.origin);
    if (url.pathname.startsWith('/demo-api/')) return handle(input, init);
    return nativeFetch(input, init);
  };
})();
