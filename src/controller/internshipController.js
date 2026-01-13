// /mnt/data/internshipController.js
const db = require("../config/db");

/**
 * Helper: build base SELECT with aggregated domains
 */
const BASE_SELECT_WITH_DOMAINS = `
  SELECT 
    i.*,
    COALESCE(
      json_agg(
        json_build_object(
          'id', d.id,
          'domain_name', d.domain_name,
          'skills', d.skills,
          'tasks', d.tasks,
          'hours', d.hours,
          'start_date', to_char(d.start_date, 'YYYY-MM-DD'),
          'end_date', to_char(d.end_date, 'YYYY-MM-DD'),
          'duration', d.duration,
          'view_details', d.view_details,
          'limit_value', d.limit_value,
          'seats_left', d.seats_left,
          'join_count', d.join_count
        )
      ) FILTER (WHERE d.id IS NOT NULL),
    '[]') AS domains
  FROM mentor.internships i
  LEFT JOIN mentor.internship_domains d ON i.id = d.internship_id
`;

/* ===========================
   CREATE internship (with domain rows)
   =========================== */
const createInternship = async (req, res) => {
  try {
    await db.query("BEGIN");

    const {
      internship_title,
      description,
      price,
      approval_required,
      host_domain,
      co_host_name,
      co_host_id,
      tech,
      management,
    } = req.body;

    const mentorId = req.user.id; // logged in mentor

    // 1️⃣ Create Internship
    const internshipResult = await db.query(
      `
      INSERT INTO mentedge.internships (
        internship_title, description, price,
        approval_required
      )
      VALUES ($1, $2, $3, $4)
      RETURNING id
      `,
      [internship_title, description, price, approval_required]
    );

    const internshipId = internshipResult.rows[0].id;

    // 2️⃣ Insert Host Mentor
    await db.query(
      `
      INSERT INTO mentedge.internship_hosts (
        internship_id, mentor_id, role, domain
      )
      VALUES ($1, $2, 'host', $3)
      `,
      [internshipId, mentorId, host_domain]
    );

    // 3️⃣ Insert Co-host placeholder (optional)
    if (co_host_name) {
      await db.query(
        `
        INSERT INTO mentedge.internship_hosts (
          internship_id, mentor_id, role, domain
        )
        VALUES ($1, $2, 'co-host', $3)
        `,
        [
          internshipId,
          co_host_id,
          host_domain === "tech" ? "management" : "tech",
        ]
      );
    }

    // 4️⃣ Insert Domain Data (ONLY HOST DOMAIN)
    const domainData = host_domain === "tech" ? tech : management;

    await db.query(
      `
      INSERT INTO mentedge.internship_domains (
        internship_id, domain_description,
        skills_required, tools_used, tags, tasks,
        deliverables, milestones, start_date, end_date, application_deadline,
        weekly_hours, duration, difficulty_level, marketplace_category, domain_name, max_seats
      )
      VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17
      )
      `,
      [
        internshipId,
        domainData.domain_description,
        domainData.skills_required,
        domainData.tools_used,
        domainData.tags,
        domainData.tasks,
        domainData.deliverables,
        domainData.milestones,
        domainData.start_date,
        domainData.end_date,
        domainData.application_deadline,
        domainData.weekly_hours,
        domainData.duration,
        domainData.difficulty_level,
        domainData.marketplace_category,
        domainData.domain_name,
        domainData.max_seats,
      ]
    );

    await db.query("COMMIT");

    res.status(201).json({
      message: "Internship created",
      internship_id: internshipId,
    });
  } catch (err) {
    await db.query("ROLLBACK");
    console.error(err);
    res.status(500).json({ message: "Failed to create internship" });
  }
};

/* ===========================
   GET ALL internships (with domains)
   =========================== */
const getAllInternships = async (req, res) => {
  try {
    const result = await pool.query(`
      ${BASE_SELECT_WITH_DOMAINS}
      GROUP BY i.id
      ORDER BY i.id DESC
    `);
    return res.status(200).json(result.rows);
  } catch (err) {
    console.error("getAllInternships error:", err);
    return res.status(500).json({ error: "Failed to fetch internships" });
  }
};

const getCurrentMentorInternships = async (req, res) => {
  try {
    const mentorId = req.user.id;
    const getCurrentMentorInternshipsQuery = `SELECT 
  i.id,
  i.internship_title,
  i.description,
  i.price,
  i.status,
  i.approval_required,
  i.created_at,

  (
    SELECT json_object_agg(
      d.domain_name,
      json_build_object(
        'description', d.domain_description,
        'skills_required', d.skills_required,
        'tools_used', d.tools_used,
        'tags', d.tags,
        'tasks', d.tasks,
        'deliverables', d.deliverables,
        'milestones', d.milestones,
        'weekly_hours', d.weekly_hours,
        'duration', d.duration,
        'start_date', d.start_date,
        'end_date', d.end_date,
        'application_deadline', d.application_deadline,
        'difficulty_level', d.difficulty_level,
        'marketplace_category', d.marketplace_category,
        'max_seats', d.max_seats
      )
    )
    FROM mentedge.internship_domains d
    WHERE d.internship_id = i.id
  ) AS domains,

  -- current user role (host or co-host)
  (
    SELECT json_build_object(
      'role', h.role,
      'domain', h.domain
    )
    FROM mentedge.internship_hosts h
    WHERE h.internship_id = i.id
      AND h.mentor_id = $1
  ) AS my_role,

  -- host mentor
  COALESCE((
    SELECT json_agg(
      json_build_object(
        'id', m.id,
        'full_name', m.full_name,
        'avatar', m.avatar,
        'role', h.role,
        'domain', h.domain
      )
    )
    FROM mentedge.internship_hosts h
    JOIN mentedge.mentors m ON m.id = h.mentor_id
    WHERE h.internship_id = i.id
      AND h.role = 'host'
  ), '[]'::json) AS host,

  -- co-host
  COALESCE((
    SELECT json_agg(
      json_build_object(
        'id', m.id,
        'full_name', m.full_name,
        'avatar', m.avatar,
        'role', h.role,
        'domain', h.domain
      )
    )
    FROM mentedge.internship_hosts h
    JOIN mentedge.mentors m ON m.id = h.mentor_id
    WHERE h.internship_id = i.id
      AND h.role = 'co-host'
  ), '[]'::json) AS co_host

FROM mentedge.internships i
WHERE EXISTS (
  SELECT 1
  FROM mentedge.internship_hosts h
  WHERE h.internship_id = i.id
    AND h.mentor_id = $1
)
ORDER BY i.created_at DESC;

`;

    const result = await db.query({
      text: getCurrentMentorInternshipsQuery,
      values: [mentorId],
    });
    return res.status(200).json(result.rows);
  } catch (err) {
    console.error("getCurrentMentorInternships error:", err);
    return res.status(500).json({ error: "Failed to fetch internships" });
  }
};

const getCurrentRequestedInternships = async (req, res) => {
  const currenrRequestedInternshipsQuery = `SELECT 
  i.id,
  i.internship_title,
  i.description,
  i.price,
  i.status,
  i.created_at,

  (
    SELECT json_object_agg(
      d.domain_name,
      json_build_object(
        'description', d.domain_description,
        'skills_required', d.skills_required,
        'tools_used', d.tools_used,
        'tags', d.tags,
        'tasks', d.tasks,
        'deliverables', d.deliverables,
        'milestones', d.milestones,
        'weekly_hours', d.weekly_hours,
        'duration', d.duration,
        'start_date', d.start_date,
        'end_date', d.end_date,
        'application_deadline', d.application_deadline,
        'difficulty_level', d.difficulty_level,
        'marketplace_category', d.marketplace_category,
        'max_seats', d.max_seats
      )
    )
    FROM mentedge.internship_domains d
    WHERE d.internship_id = i.id
  ) AS domains,

  -- current user role (host or co-host)
  (
    SELECT json_build_object(
      'role', h.role,
      'domain', h.domain
    )
    FROM mentedge.internship_hosts h
    WHERE h.internship_id = i.id
      AND h.mentor_id = $1
  ) AS my_role,

  -- host mentor
  COALESCE((
    SELECT json_agg(
      json_build_object(
        'id', m.id,
        'full_name', m.full_name,
        'avatar', m.avatar,
        'role', h.role,
        'domain', h.domain
      )
    )
    FROM mentedge.internship_hosts h
    JOIN mentedge.mentors m ON m.id = h.mentor_id
    WHERE h.internship_id = i.id
      AND h.role = 'host'
  ), '[]'::json) AS host,

  -- co-host
  COALESCE((
    SELECT json_agg(
      json_build_object(
        'id', m.id,
        'full_name', m.full_name,
        'avatar', m.avatar,
        'role', h.role,
        'domain', h.domain
      )
    )
    FROM mentedge.internship_hosts h
    JOIN mentedge.mentors m ON m.id = h.mentor_id
    WHERE h.internship_id = i.id
      AND h.role = 'co-host'
  ), '[]'::json) AS co_host

  FROM mentedge.internships i JOIN mentedge.internship_hosts h ON i.id = h.internship_id
  WHERE h.mentor_id = $1 AND h.role = 'co-host' AND i.status = 'draft' ORDER BY i.created_at DESC;
;

`;

  try {
    const result = await db.query({
      text: currenrRequestedInternshipsQuery,
      values: [req.user.id],
    });
    return res.status(200).json(result.rows);
  } catch (err) {
    console.error("getCurrentRequestedInternships error:", err);
    return res.status(500).json({ error: "Failed to fetch internships" });
  }
};

/* ===========================
   GET internship by id (with domains)
   =========================== */
const getInternshipById = async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      `
      ${BASE_SELECT_WITH_DOMAINS}
      WHERE i.id = $1
      GROUP BY i.id
      LIMIT 1
    `,
      [id]
    );

    if (result.rowCount === 0)
      return res.status(404).json({ message: "Internship not found" });
    return res.json(result.rows[0]);
  } catch (err) {
    console.error("getInternshipById error:", err);
    return res.status(500).json({ error: "Failed to fetch internship" });
  }
};

/* ===========================
   UPDATE internship (main + domains)
   - Expects optional `domains` array:
     each domain object may include `id` (to update) or no id (to insert new)
   - If updating limit_value, we adjust seats_left = limit_value - join_count (preserving join_count)
   =========================== */
const updateInternship = async (req, res) => {
  const client = await pool.connect();
  try {
    const { id } = req.params;
    const {
      hostRole,
      hostName,
      internTitle,
      internId,
      internCategory,
      price,
      cohost,
      tools,
      marketplace,
      smallDetails,
      status,
      domains, // optional array with domain updates/inserts
    } = req.body;

    await client.query("BEGIN");

    // 1) Update main internship
    const updateMain = await client.query(
      `UPDATE mentor.internships SET
         host_role = COALESCE($1, host_role)
, host_name=$2, intern_title=$3, intern_id=$4,
         intern_category=$5, price=$6, cohost=$7, tools=$8,
         marketplace=$9, small_details=$10, status=$11
       WHERE id=$12
       RETURNING *`,
      [
        hostRole,
        hostName,
        internTitle,
        internId,
        internCategory,
        price,
        cohost,
        tools,
        marketplace,
        smallDetails,
        status || "draft",
        id,
      ]
    );

    if (updateMain.rowCount === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ message: "Internship not found" });
    }

    // 2) Upsert domain rows if provided
    if (domains && Array.isArray(domains)) {
      for (const d of domains) {
        // If domain id exists => update, else insert
        if (d.id) {
          // Fetch existing join_count
          const domainRes = await client.query(
            `SELECT join_count FROM mentor.internship_domains WHERE id = $1 FOR UPDATE`,
            [d.id]
          );
          if (domainRes.rowCount === 0) {
            await client.query("ROLLBACK");
            return res
              .status(404)
              .json({ message: `Domain id ${d.id} not found` });
          }
          const currentJoinCount = Number(domainRes.rows[0].join_count || 0);

          // If limit_value is being updated, ensure it's not less than join_count
          if (typeof d.limit_value !== "undefined" && d.limit_value !== null) {
            const newLimit =
              d.limit_value === null || d.limit_value === undefined
                ? null
                : Number(d.limit_value);

            if (newLimit !== null && Number.isNaN(newLimit)) {
              throw new Error("Invalid limit_value received");
            }

            if (newLimit < currentJoinCount) {
              await client.query("ROLLBACK");
              return res.status(400).json({
                message: `limit_value (${newLimit}) cannot be less than existing join_count (${currentJoinCount}) for domain id ${d.id}`,
              });
            }
            // seats_left should be adjusted to newLimit - join_count
            const newSeatsLeft = newLimit - currentJoinCount;
            await client.query(
              `UPDATE mentor.internship_domains SET
                 domain_name=$1, skills=$2, tasks=$3, hours=$4,
                 start_date=$5, end_date=$6, duration=$7, view_details=$8,
                 limit_value=$9, seats_left=$10
               WHERE id=$11`,
              [
                d.domain_name || undefined,
                d.skills || null,
                d.tasks || null,
                d.hours || null,
                d.start_date || null,
                d.end_date || null,
                d.duration || null,
                d.view_details || null,
                newLimit,
                newSeatsLeft,
                d.id,
              ]
            );
          } else {
            // No change to limit_value — update other fields (preserve seats_left & join_count)
            await client.query(
              `UPDATE mentor.internship_domains SET
                 domain_name=$1, skills=$2, tasks=$3, hours=$4,
                 start_date=$5, end_date=$6, duration=$7, view_details=$8
               WHERE id=$9`,
              [
                d.domain_name || undefined,
                d.skills || null,
                d.tasks || null,
                d.hours || null,
                d.start_date || null,
                d.end_date || null,
                d.duration || null,
                d.view_details || null,
                d.id,
              ]
            );
          }
        } else {
          // Insert new domain row for this internship
          const limitValue = d.limit_value ? parseInt(d.limit_value, 10) : null;
          const seatsInit = limitValue !== null ? limitValue : null;
          await client.query(
            `INSERT INTO mentor.internship_domains (
               internship_id, domain_name, skills, tasks, hours,
               start_date, end_date, duration, view_details,
               limit_value, seats_left, join_count
             ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,0)`,
            [
              id,
              d.domain_name,
              d.skills || null,
              d.tasks || null,
              d.hours || null,
              d.start_date || null,
              d.end_date || null,
              d.duration || null,
              d.view_details || null,
              limitValue,
              seatsInit,
            ]
          );
        }
      }
    }

    await client.query("COMMIT");
    return res.json({
      success: true,
      message: "Internship updated successfully",
      internship: updateMain.rows[0],
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("updateInternship error:", err);
    return res.status(500).json({ error: "Failed to update internship" });
  } finally {
    client.release();
  }
};

/* ===========================
   DELETE internship
   =========================== */
const deleteInternship = async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      "DELETE FROM mentor.internships WHERE id = $1 RETURNING *",
      [id]
    );
    if (result.rowCount === 0)
      return res.status(404).json({ message: "Internship not found" });
    return res.json({ message: "Internship deleted" });
  } catch (err) {
    console.error("deleteInternship error:", err);
    return res.status(500).json({ error: "Failed to delete internship" });
  }
};

/* ===========================
   Open for Co-host (workflow)
   =========================== */
const openForCohost = async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      "UPDATE mentor.internships SET status = 'pending_cohost' WHERE id = $1 RETURNING *",
      [id]
    );
    if (result.rowCount === 0)
      return res.status(404).json({ message: "Internship not found" });
    return res.json({
      message: "Opened for co-host",
      internship: result.rows[0],
    });
  } catch (err) {
    console.error("openForCohost error:", err);
    return res.status(500).json({ error: "Failed to open for co-host" });
  }
};

/* ===========================
   Approve & Post
   =========================== */
const approveAndPost = async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      "UPDATE mentor.internships SET status = 'published' WHERE id = $1 RETURNING *",
      [id]
    );
    if (result.rowCount === 0)
      return res.status(404).json({ message: "Internship not found" });
    return res.json({
      message: "Approved & posted",
      internship: result.rows[0],
    });
  } catch (err) {
    console.error("approveAndPost error:", err);
    return res.status(500).json({ error: "Failed to approve and post" });
  }
};

/* ===========================
   sendToHost (cohost edits a domain or main fields and sends back)
   - If body contains domain_id => update that domain and mark internship status updated_by_cohost
   - else update main internship small_details/status
   =========================== */
/* ===========================
   sendToHost (CO-HOST FLOW)
   =========================== */
const sendToHost = async (req, res) => {
  const client = await pool.connect();

  try {
    const { id } = req.params; // internship id

    // ✅ destructure using snake_case (matches frontend + DB)
    const {
      domain_id,
      hours,
      small_details,
      view_details,
      start_date,
      end_date,
      limit_value,
    } = req.body;

    await client.query("BEGIN");

    /* ===========================
       DOMAIN UPDATE (CO-HOST)
       =========================== */
    if (domain_id) {
      // 1️⃣ Fetch join_count safely
      const dRes = await client.query(
        `SELECT join_count FROM mentor.internship_domains WHERE id = $1 FOR UPDATE`,
        [domain_id]
      );

      if (dRes.rowCount === 0) {
        await client.query("ROLLBACK");
        return res.status(404).json({ message: "Domain not found" });
      }

      const joinCount = Number(dRes.rows[0].join_count || 0);

      // 2️⃣ Parse & validate limit_value (🔥 FIXES YOUR ERROR)
      const parsedLimit =
        limit_value === undefined || limit_value === null || limit_value === ""
          ? null
          : Number(limit_value);

      if (parsedLimit !== null && Number.isNaN(parsedLimit)) {
        await client.query("ROLLBACK");
        return res.status(400).json({ message: "Invalid limit_value" });
      }

      if (parsedLimit !== null && parsedLimit < joinCount) {
        await client.query("ROLLBACK");
        return res.status(400).json({
          message: "limit_value cannot be less than existing join_count",
        });
      }

      // 3️⃣ Update domain safely
      const updateDomain = await client.query(
        `UPDATE mentor.internship_domains
   SET
     hours = $1,
     view_details = $2,
     start_date = $3,
     end_date = $4,
     duration = $5,
     limit_value = $6::INTEGER,
     seats_left = CASE
       WHEN $6::INTEGER IS NOT NULL THEN ($6::INTEGER - join_count)
       ELSE seats_left
     END
   WHERE id = $7
   RETURNING *`,
        [
          hours || null,
          view_details || null,
          start_date || null,
          end_date || null,
          null, // duration
          parsedLimit, // INTEGER or NULL
          domain_id,
        ]
      );

      // 4️⃣ Mark internship as updated_by_cohost
      await client.query(
        `UPDATE mentor.internships
         SET status = 'updated_by_cohost'
         WHERE id = $1`,
        [id]
      );

      await client.query("COMMIT");
      return res.json({
        message: "Domain updated by co-host",
        domain: updateDomain.rows[0],
      });
    }

    /* ===========================
       MAIN INTERNSHIP UPDATE
       (small_details only)
       =========================== */
    const updateMain = await client.query(
      `UPDATE mentor.internships
       SET small_details = $1,
           status = 'updated_by_cohost'
       WHERE id = $2
       RETURNING *`,
      [small_details || null, id]
    );

    if (updateMain.rowCount === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ message: "Internship not found" });
    }

    await client.query("COMMIT");
    return res.json({
      message: "Internship updated by co-host",
      internship: updateMain.rows[0],
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("sendToHost error:", err);
    return res.status(500).json({ error: "Failed to send to host" });
  } finally {
    client.release();
  }
};

/* ===========================
   GET internships by filter (returns domains array too)
   =========================== */
const getInternshipsByFilter = async (req, res) => {
  try {
    const { filter } = req.params;
    let whereClause = "";
    if (filter === "open") {
      whereClause = "WHERE i.status IN ('pending_cohost','cohost')";
    } else if (filter === "sent") {
      whereClause = "WHERE i.status IN ('updated_by_cohost','draft')";
    } else if (filter === "approved") {
      whereClause = "WHERE i.status IN ('posted','published')";
    }

    const result = await pool.query(`
      ${BASE_SELECT_WITH_DOMAINS}
      ${whereClause}
      GROUP BY i.id
      ORDER BY i.id DESC
    `);

    return res.status(200).json(result.rows);
  } catch (err) {
    console.error("getInternshipsByFilter error:", err);
    return res.status(500).json({ error: "Failed to fetch internships" });
  }
};

/* ===========================
   DOMAIN-WISE JOIN (replaces legacy internship join)
   - Expects: { intern_id, domain_id }
   - Inserts into mentor.internship_joined (intern_id, internship_id, domain_id)
   - Updates seats_left and join_count on domain row
   =========================== */
const joinInternship = async (req, res) => {
  const client = await pool.connect();
  try {
    const { intern_id, domain_id } = req.body;

    if (!intern_id || !domain_id) {
      return res
        .status(400)
        .json({ message: "intern_id and domain_id are required" });
    }

    await client.query("BEGIN");

    const dRes = await client.query(
      `SELECT internship_id, seats_left, join_count FROM mentor.internship_domains WHERE id=$1 FOR UPDATE`,
      [domain_id]
    );

    if (dRes.rowCount === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ message: "Domain not found" });
    }

    const domain = dRes.rows[0];
    if (domain.seats_left <= 0) {
      await client.query("ROLLBACK");
      return res
        .status(400)
        .json({ message: "No seats available for this domain" });
    }

    // prevent double join for same domain
    const checkRes = await client.query(
      `SELECT * FROM mentor.internship_joined WHERE intern_id=$1 AND domain_id=$2`,
      [intern_id, domain_id]
    );

    if (checkRes.rowCount > 0) {
      await client.query("ROLLBACK");
      return res.status(400).json({ message: "Already joined this domain" });
    }

    // insert into joined table (assumes joined_at has default CURRENT_TIMESTAMP)
    await client.query(
      `INSERT INTO mentor.internship_joined (intern_id, internship_id, domain_id)
       VALUES ($1,$2,$3)`,
      [intern_id, domain.internship_id, domain_id]
    );

    // update seats_left and join_count
    await client.query(
      `UPDATE mentor.internship_domains
       SET seats_left = seats_left - 1,
           join_count = join_count + 1
       WHERE id = $1`,
      [domain_id]
    );

    await client.query("COMMIT");
    return res.json({ success: true, message: "Joined domain successfully" });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("joinInternship error:", err);
    return res.status(500).json({ error: "Failed to join domain" });
  } finally {
    client.release();
  }
};

/* ===========================
   Get joined internships for an intern (domain aware)
   returns joined records with internship + domain info
   =========================== */
const getJoinedInternships = async (req, res) => {
  try {
    const { internId } = req.params;

    const result = await pool.query(
      `SELECT j.*, i.intern_title, i.host_name, i.intern_category,
              d.id AS domain_id, d.domain_name, d.view_details, d.start_date, d.end_date, d.duration
       FROM mentor.internship_joined j
       JOIN mentor.internships i ON i.id = j.internship_id
       LEFT JOIN mentor.internship_domains d ON d.id = j.domain_id
       WHERE j.intern_id = $1
       ORDER BY j.joined_at DESC NULLS LAST`,
      [internId]
    );

    return res.json(result.rows);
  } catch (err) {
    console.error("getJoinedInternships error:", err);
    return res
      .status(500)
      .json({ error: "Failed to fetch joined internships" });
  }
};

/* ===========================
   Get ongoing internships for an intern (domain-aware)
   Fetches domain records where current_date between domain start/end for domains the intern joined
   =========================== */
const getOngoingInternships = async (req, res) => {
  try {
    const { internId } = req.params;

    const result = await pool.query(
      `SELECT i.*, d.*
       FROM mentor.internship_joined j
       JOIN mentor.internship_domains d ON d.id = j.domain_id
       JOIN mentor.internships i ON i.id = j.internship_id
       WHERE j.intern_id = $1
       AND CURRENT_DATE BETWEEN d.start_date AND d.end_date
       ORDER BY d.start_date ASC`,
      [internId]
    );

    return res.json(result.rows);
  } catch (err) {
    console.error("getOngoingInternships error:", err);
    return res
      .status(500)
      .json({ error: "Failed to fetch ongoing internships" });
  }
};

module.exports = {
  createInternship,
  getAllInternships,
  getInternshipById,
  updateInternship,
  deleteInternship,
  openForCohost,
  approveAndPost,
  sendToHost,
  getInternshipsByFilter,
  joinInternship,
  getJoinedInternships,
  getOngoingInternships,
  getCurrentMentorInternships,
  getCurrentRequestedInternships
};
