import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export const useProductStore = create(
   persist( 
  (set) => ({
  ItemId: "", 
  AllProducts: [],
  productObj: {},
  sku: "",
  searchProduct: "",
  competitors: [],
  authToken: "",
  modifyCompetitors: (competitors) => set({ competitors }),
  modifySearch : (searchProduct) => set({searchProduct}),
  modifyAuthToken: (authToken) => set({ authToken }),
  modifyProductsObj: (productObj) => set({ productObj }),
  modifyProductsArray: (AllProducts) => set({ AllProducts }),
  modifyProductsId: (ItemId) => set({ ItemId}),
  modifySku: (sku) => set({sku}),
}),
{
    name: 'product-store'
})
)



// useProductStore.persist.clearStorage();