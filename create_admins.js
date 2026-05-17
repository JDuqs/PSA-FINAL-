// const { supabase } = require('./config.js?raw'); // Won't work, using inline instead

// INLINE SUPABASE CONFIG (public anon key safe for insert)
const SUPABASE_URL = 'https://bnkqrvsfioadhgvhylur.supabase.co';
const SUPABASE_KEY = 'sb_publishable_YzlzjTy_eTVFhXOOvfsAiQ_5bRGVzMi';

async function createAdmins() {
  // Admin emails from config.js
  const admins = [
    { email: 'admin@psa.gov.ph', name: 'Rigor S. Cubinor', role: 'admin', department: 'PSA' },
    // { email: 'admin1@psa.gov.ph', name: 'Jenor B. Blas', role: 'admin', department: 'Property' }, // Replaced by super admin creator
    // { email: 'admin2@psa.gov.ph', name: 'Mary Anne G. Basilio', role: 'admin', department: 'Inspection' }, // Replaced by super admin creator
    // { email: 'admin3@psa.gov.ph', name: 'Maricel M. Caragan', role: 'admin', department: 'OIC' }, // Replaced by super admin creator
    { email: 'admin4@psa.gov.ph', name: 'Joemar P. Jerez', role: 'viewer', department: 'Viewer' },
    { email: 'admin5@psa.gov.ph', name: 'Judie Rhisa G. Baluran', role: 'viewer', department: 'Viewer' }
  ];

  console.log('🔧 Creating PSA Admin users in database...');

  const { createClient } = require('@supabase/supabase-js');
  const sb = createClient(SUPABASE_URL, SUPABASE_KEY);

  for (const admin of admins) {
    try {
      // Upsert with default password 'admin123' (change later)
      const { error } = await sb.from('users').upsert({
        email: admin.email,
        name: admin.name,
        password: 'admin123', // Default - change via Supabase dashboard
        role: admin.role,
        approved: true,
        department: admin.department
      }, { onConflict: 'email' });

      if (!error) {
        console.log(`✅ ${admin.email} created/updated (role: ${admin.role})`);
      } else {
        console.log(`❌ Error for ${admin.email}:`, error.message);
      }
    } catch (e) {
      console.log(`💥 Failed ${admin.email}:`, e.message);
    }
  }

  console.log('\n📋 **ALL admins created!**');
  console.log('💡 Default password for all: admin123');
  console.log('🔐 Change passwords in Supabase dashboard > Authentication > Users');
  console.log('🚀 Test login at index.html');
}

createAdmins();
