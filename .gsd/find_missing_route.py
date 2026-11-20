import os
import glob

api_dir = 'apps/merchant-web/src/app/api'
route_files = glob.glob(f'{api_dir}/**/route.ts', recursive=True)

routes_on_disk = set()
for rf in route_files:
    rel = os.path.relpath(rf, 'apps/merchant-web/src/app')
    route_path = '/' + os.path.dirname(rel)
    routes_on_disk.add(route_path)

print(f"Total routes on disk: {len(routes_on_disk)}")

# Discovered in test output: 39 routes
discovered_in_test = [
  '/api/account/delete',
  '/api/account/delete-public-request',
  '/api/account/export',
  '/api/admin/doctor-assignments',
  '/api/admin/refunds',
  '/api/auth/me',
  '/api/auth/otp/send',
  '/api/auth/otp/verify',
  '/api/bookings/admit',
  '/api/bookings/cancel',
  '/api/bookings/checkin',
  '/api/bookings/collect-fee',
  '/api/bookings/confirm',
  '/api/bookings/emergency-choice',
  '/api/bookings/end',
  '/api/bookings/offline',
  '/api/bookings/override',
  '/api/bookings/reorder',
  '/api/bookings/start',
  '/api/cities/waitlist',
  '/api/cron/security-monitor',
  '/api/customer/queue-and-history',
  '/api/doctor/emergency-cancel',
  '/api/health',
  '/api/hospital/audit-logs',
  '/api/hospital/context',
  '/api/hospital/departments',
  '/api/hospital/members',
  '/api/merchant/doctor-status',
  '/api/merchants/cashfree-vendor',
  '/api/notifications/push',
  '/api/payments/create-order',
  '/api/payments/verify',
  '/api/prescriptions/signed-url',
  '/api/queue/broadcast',
  '/api/slots/availability',
  '/api/ticket/[id]',
  '/api/webhooks/cashfree',
  '/api/webhooks/razorpay'
]

diff = routes_on_disk - set(discovered_in_test)
print(f"Routes on disk but not in 39 list: {diff}")
for d in diff:
    print(f"MISSING ROUTE: {d}")

diff2 = set(discovered_in_test) - routes_on_disk
print(f"Routes in 39 list but not in disk list: {diff2}")
