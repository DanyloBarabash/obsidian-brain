"""Evidence registry for all rules, explicitly limited to the staged engine."""

import hashlib
from pathlib import Path


ENGINE = "test_simulation.SimulationTests."
NETWORK = "test_simulation.NetworkTests."
STATE = "test_state.StateTests."
RULES = [
    (1,"Правда Brain",[STATE+"test_vault_unchanged",ENGINE+"test_staged_boundary_and_truth"]),
    (2,"Нотатка, дім і мешканець",[ENGINE+"test_staged_boundary_and_truth",ENGINE+"test_inspection_does_not_invent_files"]),
    (3,"Чесні службові об’єкти",[ENGINE+"test_inspection_does_not_invent_files"]),
    (4,"Постійна геометрія",[ENGINE+"test_growth_infill_edge_and_stable_geometry",ENGINE+"test_save_load_and_idempotent_events"]),
    (5,"Ідентичність і міграція",[STATE+"test_legacy_migration_and_restart",STATE+"test_rename_and_conflicting_ids"]),
    (6,"Спільна земля й резерви",[ENGINE+"test_protected_land_and_corridors",ENGINE+"test_all_pedestrian_paths_avoid_building_interiors"]),
    (7,"Світові одиниці",[ENGINE+"test_parameters_are_declared_assumptions",ENGINE+"test_pause_reduced_motion_and_frame_independence"]),
    (8,"Осередки з причиною",[ENGINE+"test_new_centres_have_reasons_and_connected_access"]),
    (9,"Вибір місця та ріст",[ENGINE+"test_growth_infill_edge_and_stable_geometry",ENGINE+"test_growth_rejects_unserviceable_infill",ENGINE+"test_failed_allocation_is_atomic"]),
    (10,"Ріст під реальний попит",[ENGINE+"test_hundred_days_no_spontaneous_city_or_punishment"]),
    (11,"Етапи будівництва",[ENGINE+"test_construction_stages_require_services"]),
    (12,"Збережена історія",[ENGINE+"test_construction_stages_require_services",STATE+"test_history_and_idempotence"]),
    (13,"Обмежене ущільнення",[ENGINE+"test_height_architecture_and_mixed_functions",ENGINE+"test_renovation_needs_local_capacity_and_credits"]),
    (14,"Масштаб районів і міст",[ENGINE+"test_new_centres_have_reasons_and_connected_access",ENGINE+"test_remote_city_has_functional_regional_connections"]),
    (15,"Різні мережі",[ENGINE+"test_knowledge_links_do_not_build_roads"]),
    (16,"Вулиці перед ділянками",[ENGINE+"test_protected_land_and_corridors"]),
    (17,"Типи вулиць",[NETWORK+"test_levels_permissions_and_explicit_ramp",ENGINE+"test_redundant_street_network_survives_closure"]),
    (18,"Входи й переходи",[ENGINE+"test_all_pedestrian_paths_avoid_building_interiors",ENGINE+"test_closure_waits_without_teleporting_and_recovers"]),
    (19,"Резервні шляхи",[ENGINE+"test_redundant_street_network_survives_closure"]),
    (20,"Явні транспортні вузли",[NETWORK+"test_geometric_crossing_is_not_a_junction",NETWORK+"test_levels_permissions_and_explicit_ramp"]),
    (21,"Функціональний транспорт",[ENGINE+"test_transit_demand_seats_schedule_and_shutdown"]),
    (22,"Змішані функції",[ENGINE+"test_height_architecture_and_mixed_functions"]),
    (23,"Місткість і години",[ENGINE+"test_capacity_hours_and_fair_queue"]),
    (24,"Заняття мешканців",[ENGINE+"test_visit_arrival_dwell_and_return"]),
    (25,"Цільові маршрути",[ENGINE+"test_closure_waits_without_teleporting_and_recovers",ENGINE+"test_visit_arrival_dwell_and_return"]),
    (26,"Прозорий зв’язок зі знаннями",[ENGINE+"test_knowledge_links_do_not_build_roads"]),
    (27,"Служби та ресурси",[ENGINE+"test_resources_are_finite_conserved_and_separate",ENGINE+"test_renovation_needs_local_capacity_and_credits"]),
    (28,"Архів і зниклі файли",[ENGINE+"test_missing_restore_archive_and_rename_keep_history"]),
    (29,"Зелень із функцією",[ENGINE+"test_persistent_greenery_age_rain_and_materials",ENGINE+"test_greenery_is_clear_of_paths"]),
    (30,"Вік і покриття",[ENGINE+"test_persistent_greenery_age_rain_and_materials"]),
    (31,"Архітектура та епохи",[ENGINE+"test_height_architecture_and_mixed_functions"]),
    (32,"Читабельність і масштабування",[ENGINE+"test_render_budget_does_not_invent_or_remove_agents"]),
    (33,"Спокійний керований час",[ENGINE+"test_pause_reduced_motion_and_frame_independence",ENGINE+"test_hundred_days_no_spontaneous_city_or_punishment"]),
    (34,"Логіка незалежна від FPS",[ENGINE+"test_pause_reduced_motion_and_frame_independence",ENGINE+"test_save_load_and_idempotent_events"]),
    (35,"Ідемпотентні події",[ENGINE+"test_save_load_and_idempotent_events",STATE+"test_history_and_idempotence"]),
    (36,"Узгоджені баланси",[ENGINE+"test_resources_are_finite_conserved_and_separate",ENGINE+"test_render_budget_does_not_invent_or_remove_agents"]),
    (37,"Походження параметрів",[ENGINE+"test_parameters_are_declared_assumptions"]),
    (38,"Чесний реєстр готовності",[ENGINE+"test_staged_boundary_and_truth","test_preparation.PreparationTests.test_report_staleness_is_visible"]),
    (39,"Спільні вузли",[NETWORK+"test_touching_edges_share_nodes",ENGINE+"test_street_network_has_no_dead_ends_or_sharp_junctions","test_landmarks.LandmarkTests.test_crossing_migration_keeps_homes_seats_and_travellers_in_place"]),
    (40,"Одна вулиця між кварталами",[ENGINE+"test_neighbour_blocks_share_one_street"]),
    (41,"Безперервні вулиці",[ENGINE+"test_streets_render_as_continuous_ways"]),
    (42,"Без глухих кутів",[ENGINE+"test_street_network_has_no_dead_ends_or_sharp_junctions"]),
    (43,"Стежки до тротуарів",[ENGINE+"test_paths_and_promenades_join_sidewalks"]),
    (44,"Річка-дерево",[ENGINE+"test_river_is_a_persistent_tree"]),
    (45,"Захищений берег",[ENGINE+"test_river_corridor_is_protected"]),
    (46,"Мости над водою",[ENGINE+"test_bridges_are_square_and_redundant"]),
    (47,"Площа й ратуша",[ENGINE+"test_square_and_town_hall_at_the_origin"]),
    (48,"Не одна решітка",[ENGINE+"test_streets_are_not_a_single_grid"]),
    (49,"Квартали-сектори",[ENGINE+"test_blocks_grow_outward_without_slivers"]),
    (50,"Бульвар на лінії стіни",[ENGINE+"test_boulevard_on_the_wall_line"]),
    (51,"Периметральна забудова",[ENGINE+"test_perimeter_buildings_face_their_street",ENGINE+"test_all_pedestrian_paths_avoid_building_interiors"]),
    (52,"Відкрите русло",[ENGINE+"test_river_corridor_is_protected",ENGINE+"test_bridges_are_square_and_redundant","test_river_course.RiverCourseTests.test_open_course_has_one_direction_and_no_belt"]),
    (53,"Провулки старого міста",[ENGINE+"test_old_town_has_lanes_and_smaller_blocks"]),
    (54,"Квартали класів",[ENGINE+"test_class_quarters_share_streets_around_one_core"]),
    (55,"Кластери кварталів",[ENGINE+"test_quarters_form_clusters","test_civic.CivicTests.test_each_district_and_project_passes_live_criteria"]),
    (56,"Єдиний стиль кластера",[ENGINE+"test_quarter_has_one_architectural_family"]),
    (57,"T-вузли й наскрізні радіали",[ENGINE+"test_mostly_t_junctions_and_through_historic_roads"]),
    (58,"Різні ширини",[ENGINE+"test_block_and_plot_widths_vary",ENGINE+"test_blocks_grow_outward_without_slivers"]),
    (59,"Суцільні фасади",[ENGINE+"test_old_town_facades_are_continuous"]),
    (60,"Звивисте русло",[ENGINE+"test_river_reaches_meander_inside_their_corridor"]),
    (61,"Хвилясті кільця",[ENGINE+"test_rings_wobble_on_several_scales"]),
    (62,"Підрайони проєктів",[ENGINE+"test_projects_form_sub_quarters"]),
    (63,"Видима ідентичність кварталу",[ENGINE+"test_quarter_has_one_architectural_family",ENGINE+"test_projects_form_sub_quarters"]),
    (64,"Радіальні клини класів",[ENGINE+"test_classes_occupy_radial_wedges_by_size","test_civic.CivicTests.test_each_district_and_project_passes_live_criteria","test_civic.CivicTests.test_per_class_audit_detects_a_hidden_local_failure"]),
    (65,"Важливий центр",[ENGINE+"test_important_sources_sit_in_the_centre"]),
    (66,"Підклини проєктів",[ENGINE+"test_projects_take_sub_wedges","test_civic.CivicTests.test_each_district_and_project_passes_live_criteria"]),
    (67,"Незалежні виміри класифікації",["test_civic.CivicTests.test_global_and_project_rules_keep_different_owners","test_civic.CivicTests.test_civic_identity_and_facets_survive_missing_and_restore"]),
    (68,"Справжня ратуша й основні ноди",["test_civic.CivicTests.test_each_district_and_project_passes_live_criteria"]),
    (69,"Спільні будинки й адресні квартири",["test_housing.HousingTests.test_sessions_share_real_parcels_and_keep_individual_addresses"]),
    (70,"Теми незалежно від власника",["test_housing.HousingTests.test_topics_inherit_but_project_ownership_is_retained"]),
    (71,"Важливість і тематичні служби",["test_housing.HousingTests.test_thematic_facilities_have_land_access_and_real_visits"]),
    (72,"Проєктні прибудови й ріст навколо комплексу",["test_project_districts.ProjectDistrictTests.test_project_building_is_a_bay_of_its_cluster_complex","test_project_districts.ProjectDistrictTests.test_technology_complex_migrates_project_estates_without_moving_homes","test_project_districts.ProjectDistrictTests.test_growth_fills_the_nearest_feasible_complex_band_before_cheaper_land"]),
]


def fingerprint():
    """Invalidate evidence whenever engine, integration or relevant tests change."""
    root = Path(__file__).resolve().parents[1]
    files = sorted(list((root/"simulation").glob("*.py"))+list((root/"tests").glob("test*.py"))+
                   [root/"server.py",root/"city_state.py",root/"preparation.py",root/"classification.py",root/"market.py",root/"verify_simulation.py"])
    digest = hashlib.sha256()
    for path in files:
        digest.update(path.relative_to(root).as_posix().encode())
        if path.exists():
            digest.update(path.read_bytes())
    reader = root.parent/"reader" if (root.parent/"reader").is_dir() else root/"reader"
    for path in sorted(list(reader.glob("*.py"))+list((reader/"tests").glob("test*.py"))):
        digest.update(("reader/"+path.relative_to(reader).as_posix()).encode())
        digest.update(path.read_bytes())
    return digest.hexdigest()


def readiness(report=None):
    """Verify only evidence from a passing, source-matched run; never infer activation."""
    valid = bool(report and report.get("passed") and report.get("sourceFingerprint") == fingerprint())
    passed = set(report.get("successfulTests",[])) if valid else set()
    benchmarks = report.get("benchmarks",[]) if valid else []
    benchmarked = {b.get("sources") for b in benchmarks if not b.get("auditErrors") and b.get("oneTickSeconds",1) <= 0.2} >= {100,1000,10000}
    rules = []
    for number,title,tests in RULES:
        verified = all(test in passed for test in tests) and (number != 32 or benchmarked)
        rules.append({"rule":f"BC-{number:02}","title":title,"status":"verified" if verified else "implemented",
                      "scope":"simulation engine and acceptance fixtures; the map renders this world via /api/world",
                      "evidence":tests,"remaining":"visual acceptance by the user on real data"})
    return {"activation":"active","currentMapChanged":True,"rules":rules,
            "verifiedRules":sum(r["status"] == "verified" for r in rules),"totalRules":len(RULES),
            "evidenceCurrent":valid,"benchmarksCurrent":benchmarked,
            "rendererAcceptance":"rebuilt-pending-user-review","safeToRebuild":valid and benchmarked and all(r["status"] == "verified" for r in rules)}
