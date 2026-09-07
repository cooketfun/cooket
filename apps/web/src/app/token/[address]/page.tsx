import type { Metadata } from "next";
import { TokenTerminal } from "./token-terminal";
import { fetchTokenMetadata } from "@/lib/token-sharing";

type TokenPageProps = { params: Promise<{ address: string }> };

export async function generateMetadata({ params }: TokenPageProps): Promise<Metadata> {
  const { address } = await params;
  return fetchTokenMetadata(address);
}

export default async function TokenDetailPage({ params }: TokenPageProps) {
  const { address } = await params;
  return <TokenTerminal address={address} />;
}
