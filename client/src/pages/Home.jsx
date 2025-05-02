import React, { useState } from "react";
import { Outlet, useLocation } from "react-router-dom";

import Header from "../componentsForHome/Header";
import NavTabs from "../componentsForHome/NavTabs";
import ActionButtons from "../componentsForHome/ActionButtons";
import ListingsHeading from "../componentsForHome/ListingsHeading";
import EntriesAndSearchBar from "../componentsForHome/EntriesAndSearchBar";
import ListingsTable from "../componentsForHome/ListingsTable";
import PaginationBar from "../componentsForHome/PaginationBar";
import Footer from "../componentsForHome/Footer";
import ScrollToTopButton from "../componentsForHome/ScrollToTopButton";
import HelpButton from "../componentsForHome/HelpButton";

export default function Home({ handleLogout }) {
  const [page, setPage] = useState(1);
  const location = useLocation();

  const isDashboard = location.pathname === "/home";

  return (
    <>
      {/* Always show layout: header, nav, footer, help */}
      <Header handleLogout={handleLogout} />
      <NavTabs />

      {/* Nested route rendering */}
      <Outlet />

      {/* Dashboard content only for /home route */}
      {isDashboard && (
        <>
          <ActionButtons />
          <ListingsHeading />
          <EntriesAndSearchBar />
          <ListingsTable />
        </>
      )}

      <PaginationBar currentPage={page} totalPages={4} onPageChange={setPage} />
      <Footer />
      <ScrollToTopButton />
      <HelpButton />
    </>
  );
}
